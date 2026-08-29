// Main-process application wiring.
//
// Assembles the database, credential service, provider registry, virtual-model
// service, gateway server and IPC handlers. This is the ONLY place provider
// packages are instantiated; the gateway and renderer stay provider-neutral.
//
// The gateway binds to 127.0.0.1 on the configured port (default 8317).

import { app, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { openDatabase, closeDatabase, type PersistedConnection } from '../database/connection'
import {
  ProviderRepository,
  ModelRepository,
  GatewayConfigRepository,
  VirtualModelRepository,
  UsageRepository,
  VirtualModelError
} from '../database/repositories'
import { createCredentialService } from '../credentials/production'
import type { CredentialService } from '../credentials/credentialService'
import { ProviderRegistry } from '@meow-gateway/provider-core'
import { createOpenAICompatibleAdapter } from '@meow-gateway/provider-openai'
import { createDeepSeekAdapter } from '@meow-gateway/provider-deepseek'
import { createGatewayServer, DEFAULT_HOST, DEFAULT_PORT, type GatewayServer } from '../gateway/server'
import type { GatewayDependencies } from '../gateway/types'
import { VirtualModelService } from '../gateway/virtualModelService'
import { UsageService } from '../gateway/usageService'
import { IPC_CHANNELS, type NewVirtualModelInput, type IpcResult } from '../../shared/ipc'
import type { VirtualModelRow } from '../database/types'

export interface MeowGatewayApp {
  db: PersistedConnection
  registry: ProviderRegistry
  credentials: CredentialService
  virtualModels: VirtualModelService
  usage: UsageService
  gateway: GatewayServer
  start(): Promise<{ host: string; port: number }>
  stop(): Promise<void>
}

export async function bootstrapMeowGatewayApp(dbPath?: string): Promise<MeowGatewayApp> {
  const filePath = dbPath ?? join(app.getPath('userData'), 'meow-gateway.sqlite')
  const db = await openDatabase(filePath)

  const providerRepo = new ProviderRepository(db)
  const modelRepo = new ModelRepository(db)
  const configRepo = new GatewayConfigRepository(db)
  const virtualModelRepo = new VirtualModelRepository(db)
  const usageRepo = new UsageRepository(db)
  const credentials = createCredentialService()

  const registry = new ProviderRegistry()
  registry.register(createOpenAICompatibleAdapter('openai'))
  registry.register(createDeepSeekAdapter('deepseek'))

  const virtualModels = new VirtualModelService(virtualModelRepo)
  const usage = new UsageService(usageRepo, modelRepo)

  const deps: GatewayDependencies = {
    registry,
    getCredential: (ref) => credentials.getCredential(ref),
    resolveModel: (id) => virtualModels.resolveModel(id),
    listModels: () => virtualModels.listModels(),
    recordUsage: (u) => usage.recordUsage(u),
    logger: console // Electron main: minimal console logger
  }

  // Configure the listener port from gateway_config if present, else default.
  const cfg = configRepo.get()
  const port = cfg?.port ?? DEFAULT_PORT

  const gateway = createGatewayServer(deps, { host: DEFAULT_HOST, port })

  // Register IPC handlers for virtual-model CRUD (T401 API exposure).
  registerIpcHandlers({
    repo: virtualModelRepo,
    providerRepo,
    modelRepo,
    registry
  })

  // Guard against Electron not providing safeStorage in some dev contexts.
  void safeStorage

  return {
    db,
    registry,
    credentials,
    virtualModels,
    usage,
    gateway,
    async start() {
      const addr = await gateway.start()
      return addr
    },
    async stop() {
      await gateway.stop()
      closeDatabase(db)
    }
  }
}

interface IpcHandlers {
  repo: VirtualModelRepository
  providerRepo: ProviderRepository
  modelRepo: ModelRepository
  registry: ProviderRegistry
}

function registerIpcHandlers(handlers: IpcHandlers): void {
  const { repo } = handlers

  ipcMain.handle(IPC_CHANNELS.virtualModel.list, async (): Promise<IpcResult<VirtualModelRow[]>> => {
    return wrap(() => repo.list())
  })

  ipcMain.handle(IPC_CHANNELS.virtualModel.get, async (_e, id: string): Promise<IpcResult<VirtualModelRow | null>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.')
    return wrap(() => repo.findById(id) ?? null)
  })

  ipcMain.handle(
    IPC_CHANNELS.virtualModel.create,
    async (_e, input: NewVirtualModelInput): Promise<IpcResult<VirtualModelRow>> => {
      if (!isValidVirtualModelInput(input)) return badRequest('Invalid virtual-model input.')
      return wrap(() => repo.create(input))
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.virtualModel.update,
    async (_e, id: string, patch: Partial<NewVirtualModelInput>): Promise<IpcResult<VirtualModelRow | null>> => {
      if (!isNonEmptyString(id) || !isObject(patch)) return badRequest('Invalid update arguments.')
      return wrap(() => repo.update(id, patch) ?? null)
    }
  )

  ipcMain.handle(IPC_CHANNELS.virtualModel.delete, async (_e, id: string): Promise<IpcResult<boolean>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.')
    return wrap(() => repo.delete(id))
  })
}

// --- IPC input validation (T801) -------------------------------------------
// The renderer is untrusted; validate every IPC payload before touching the DB.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isValidVirtualModelInput(v: unknown): v is NewVirtualModelInput {
  if (!isObject(v)) return false
  if (v['id'] !== undefined && !isNonEmptyString(v['id'])) return false
  if (!isNonEmptyString(v['display_name']) || !isNonEmptyString(v['provider_id']) || !isNonEmptyString(v['provider_model_id'])) {
    return false
  }
  if (v['routing_policy_id'] !== undefined && v['routing_policy_id'] !== null && !isNonEmptyString(v['routing_policy_id'])) {
    return false
  }
  if (v['enabled'] !== undefined && typeof v['enabled'] !== 'boolean') return false
  return true
}

function badRequest(message: string): IpcResult<never> {
  return { ok: false, error: { message, code: 'INVALID_VIRTUAL_MODEL' } }
}

async function wrap<T>(fn: () => T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: fn() }
  } catch (err) {
    if (err instanceof VirtualModelError) {
      return { ok: false, error: { message: err.message, code: 'INVALID_VIRTUAL_MODEL' } }
    }
    return { ok: false, error: { message: err instanceof Error ? err.message : 'Unknown error', code: 'INTERNAL_ERROR' } }
  }
}
