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
  AccountRepository,
  ModelRepository,
  GatewayConfigRepository,
  VirtualModelRepository,
  UsageRepository,
  VirtualModelError
} from '../database/repositories'
import { createCredentialService } from '../credentials/production'
import type { CredentialService } from '../credentials/credentialService'
import { CredentialError } from '../credentials/types'
import { ProviderRegistry, ProviderError, type CredentialCheckResult } from '@meow-gateway/provider-core'
import { createOpenAICompatibleAdapter } from '@meow-gateway/provider-openai'
import { createDeepSeekAdapter } from '@meow-gateway/provider-deepseek'
import { createGatewayServer, DEFAULT_HOST, DEFAULT_PORT, type GatewayServer } from '../gateway/server'
import type { GatewayDependencies } from '../gateway/types'
import { VirtualModelService } from '../gateway/virtualModelService'
import { UsageService } from '../gateway/usageService'
import { ProviderService } from '../provider/providerService'
import {
  IPC_CHANNELS,
  type NewVirtualModelInput,
  type NewProviderInput,
  type NewGatewayConfig,
  type ProviderTypeDescriptor,
  type ProviderWithCredential,
  type GatewayStatus,
  type IpcResult
} from '../../shared/ipc'
import type {
  VirtualModelRow,
  ProviderRow,
  ModelRow,
  GatewayConfigRow,
  RequestUsageRow,
  NewModel
} from '../database/types'
import type { DashboardTotals } from '../database/repositories/usageRepository'
import type { ModelInfo } from '@meow-gateway/provider-core'

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
  const accountRepo = new AccountRepository(db)
  const modelRepo = new ModelRepository(db)
  const configRepo = new GatewayConfigRepository(db)
  const virtualModelRepo = new VirtualModelRepository(db)
  const usageRepo = new UsageRepository(db)
  const credentials = createCredentialService()

  const registry = new ProviderRegistry()
  registry.register(createOpenAICompatibleAdapter('openai'))
  registry.register(createOpenAICompatibleAdapter('openrouter'))
  registry.register(createOpenAICompatibleAdapter('groq'))
  registry.register(createDeepSeekAdapter('deepseek'))
  registry.register(createOpenAICompatibleAdapter('openai-compatible'))

  const virtualModels = new VirtualModelService(virtualModelRepo)
  const usage = new UsageService(usageRepo, modelRepo)
  const providerService = new ProviderService(providerRepo, accountRepo, modelRepo, credentials, registry)

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

  // Register IPC handlers for virtual-model CRUD (T401 API exposure) plus
  // provider/model/gateway/usage channels (this feature).
  registerIpcHandlers({
    repo: virtualModelRepo,
    modelRepo,
    registry,
    providerService,
    usage,
    usageRepo,
    configRepo,
    gateway
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
  modelRepo: ModelRepository
  registry: ProviderRegistry
  providerService: ProviderService
  usage: UsageService
  usageRepo: UsageRepository
  configRepo: GatewayConfigRepository
  gateway: GatewayServer
}

function registerIpcHandlers(handlers: IpcHandlers): void {
  const { repo, modelRepo, providerService, usage, usageRepo, configRepo, gateway } = handlers

  // --- Virtual-model CRUD (unchanged) --------------------------------------
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

  // --- Providers ------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.provider.list, async (): Promise<IpcResult<ProviderWithCredential[]>> => {
    return wrap(() => providerService.listWithCredential())
  })

  ipcMain.handle(IPC_CHANNELS.provider.create, async (_e, input: NewProviderInput): Promise<IpcResult<ProviderRow>> => {
    if (!isValidNewProviderInput(input)) return badRequest('Invalid provider input.', 'INVALID_PROVIDER')
    return wrap(() => providerService.create(input))
  })

  ipcMain.handle(
    IPC_CHANNELS.provider.update,
    async (_e, id: string, patch: Record<string, unknown>): Promise<IpcResult<ProviderRow>> => {
      if (!isNonEmptyString(id) || !isObject(patch)) return badRequest('Invalid update arguments.', 'INVALID_PROVIDER')
      return wrap(() => providerService.update(id, patch) as ProviderRow)
    }
  )

  ipcMain.handle(IPC_CHANNELS.provider.delete, async (_e, id: string): Promise<IpcResult<boolean>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_PROVIDER')
    return wrap(() => providerService.delete(id))
  })

  ipcMain.handle(
    IPC_CHANNELS.provider.setCredential,
    async (_e, id: string, secret: string): Promise<IpcResult<void>> => {
      if (!isNonEmptyString(id) || !isSecret(secret)) return badRequest('Invalid credential arguments.', 'INVALID_CREDENTIAL')
      return wrap(async () => providerService.setCredential(id, secret))
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.provider.testConnection,
    async (_e, id: string): Promise<IpcResult<CredentialCheckResult>> => {
      if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_PROVIDER')
      return wrap(() => providerService.testConnection(id))
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.provider.discoverModels,
    async (_e, id: string): Promise<IpcResult<ModelInfo[]>> => {
      if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_PROVIDER')
      return wrap(() => providerService.discoverModels(id))
    }
  )

  ipcMain.handle(IPC_CHANNELS.provider.types, async (): Promise<IpcResult<ProviderTypeDescriptor[]>> => {
    return wrap(() => providerService.providerTypes())
  })

  // --- Models ---------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.model.listByProvider, async (_e, providerId: string): Promise<IpcResult<ModelRow[]>> => {
    if (!isNonEmptyString(providerId)) return badRequest('`providerId` must be a non-empty string.', 'INVALID_MODEL')
    return wrap(() => modelRepo.listByProvider(providerId))
  })

  ipcMain.handle(IPC_CHANNELS.model.create, async (_e, input: NewModel): Promise<IpcResult<ModelRow>> => {
    if (!isValidModelInput(input)) return badRequest('Invalid model input.', 'INVALID_MODEL')
    return wrap(() => providerService.createModel(input))
  })

  ipcMain.handle(IPC_CHANNELS.model.update, async (_e, id: string, patch: Record<string, unknown>): Promise<IpcResult<ModelRow>> => {
    if (!isNonEmptyString(id) || !isObject(patch)) return badRequest('Invalid update arguments.', 'INVALID_MODEL')
    if (patch['provider_id'] !== undefined) return badRequest('provider_id cannot be changed.', 'INVALID_MODEL')
    return wrap(() => providerService.updateModel(id, patch as Partial<Omit<NewModel, 'id'>>) as ModelRow)
  })

  ipcMain.handle(IPC_CHANNELS.model.delete, async (_e, id: string): Promise<IpcResult<boolean>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_MODEL')
    return wrap(() => modelRepo.delete(id))
  })

  ipcMain.handle(IPC_CHANNELS.model.setEnabled, async (_e, id: string, enabled: boolean): Promise<IpcResult<ModelRow>> => {
    if (!isNonEmptyString(id) || typeof enabled !== 'boolean') return badRequest('Invalid model toggle arguments.', 'INVALID_MODEL')
    return wrap(() => modelRepo.update(id, { enabled }) as ModelRow)
  })

  // --- Gateway --------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.gateway.getStatus, async (): Promise<IpcResult<GatewayStatus>> => {
    return wrap(() => ({ running: !!gateway.listener(), host: DEFAULT_HOST, port: gateway.getPort() }))
  })

  ipcMain.handle(IPC_CHANNELS.gateway.start, async (): Promise<IpcResult<GatewayStatus>> => {
    return wrap(async () => {
      const a = await gateway.start()
      return { running: true, host: a.host, port: a.port }
    })
  })

  ipcMain.handle(IPC_CHANNELS.gateway.stop, async (): Promise<IpcResult<GatewayStatus>> => {
    return wrap(async () => {
      await gateway.stop()
      return { running: false, host: DEFAULT_HOST, port: gateway.getPort() }
    })
  })

  ipcMain.handle(IPC_CHANNELS.gateway.getConfig, async (): Promise<IpcResult<GatewayConfigRow>> => {
    return wrap(() => configRepo.get())
  })

  ipcMain.handle(IPC_CHANNELS.gateway.saveConfig, async (_e, cfg: NewGatewayConfig): Promise<IpcResult<GatewayConfigRow>> => {
    if (!isValidGatewayConfig(cfg)) return badRequest('Invalid gateway config.', 'INVALID_GATEWAY')
    return wrap(() => configRepo.save(cfg))
  })

  // --- Usage ----------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.usage.dashboardTotals, async (): Promise<IpcResult<DashboardTotals>> => {
    return wrap(() => usage.totals())
  })

  ipcMain.handle(IPC_CHANNELS.usage.listRecent, async (_e, limit: number): Promise<IpcResult<RequestUsageRow[]>> => {
    if (!isValidLimit(limit)) return badRequest('Invalid limit.', 'INVALID_USAGE')
    return wrap(() => usageRepo.list(limit))
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

function isSecret(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 8192
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
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

export function isValidModelInput(v: unknown): v is NewModel {
  if (!isObject(v)) return false
  if (!isNonEmptyString(v['provider_id'])) return false
  if (!isNonEmptyString(v['provider_model_id'])) return false
  if (!isNonEmptyString(v['display_name'])) return false
  if (v['context_window'] !== undefined && v['context_window'] !== null && !isPositiveInt(v['context_window'])) return false
  if (v['input_price'] !== undefined && v['input_price'] !== null && !isNonNegativeNumber(v['input_price'])) return false
  if (v['output_price'] !== undefined && v['output_price'] !== null && !isNonNegativeNumber(v['output_price'])) return false
  if (v['capabilities_json'] !== undefined && v['capabilities_json'] !== null && (!isNonEmptyString(v['capabilities_json']) || v['capabilities_json'].length > 4096)) return false
  if (v['enabled'] !== undefined && typeof v['enabled'] !== 'boolean') return false
  return true
}

function isValidNewProviderInput(v: unknown): v is NewProviderInput {
  if (!isObject(v)) return false
  if (!isNonEmptyString(v['type']) || !isNonEmptyString(v['display_name'])) return false
  if (v['base_url'] !== undefined && v['base_url'] !== null && !isNonEmptyString(v['base_url'])) return false
  return true
}

function isValidGatewayConfig(v: unknown): v is NewGatewayConfig {
  if (!isObject(v)) return false
  if (typeof v['host'] !== 'string' || v['host'].length === 0) return false
  if (typeof v['port'] !== 'number' || !Number.isInteger(v['port']) || v['port'] < 1 || v['port'] > 65535) return false
  if (typeof v['auth_enabled'] !== 'boolean') return false
  if (typeof v['startup_enabled'] !== 'boolean') return false
  return true
}

function isValidLimit(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 500
}

function badRequest(message: string, code = 'INVALID_VIRTUAL_MODEL'): IpcResult<never> {
  return { ok: false, error: { message, code } }
}

async function wrap<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (err) {
    if (err instanceof VirtualModelError) {
      return { ok: false, error: { message: err.message, code: 'INVALID_VIRTUAL_MODEL' } }
    }
    if (err instanceof ProviderError) {
      return { ok: false, error: { message: err.message, code: err.type } }
    }
    if (err instanceof CredentialError) {
      return { ok: false, error: { message: err.message, code: err.code } }
    }
    return { ok: false, error: { message: err instanceof Error ? err.message : 'Unknown error', code: 'INTERNAL_ERROR' } }
  }
}
