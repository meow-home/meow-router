// Narrow typed IPC contract shared between preload, main, and renderer.
// Only non-sensitive, schema-validated payloads cross this boundary.

import type {
  VirtualModelRow,
  ProviderRow,
  ModelRow,
  GatewayConfigRow,
  RequestUsageRow,
  NewGatewayConfig,
  NewModel
} from '../main/database/types'
export type { NewGatewayConfig, ModelRow, NewModel, VirtualModelRow, GatewayConfigRow, RequestUsageRow, RequestUsageRowWithProviderName, ProviderRow } from '../main/database/types'
import type { DashboardTotals, UsagePage } from '../main/database/repositories/usageRepository'
export type { DashboardTotals, UsagePage } from '../main/database/repositories/usageRepository'
import type { ModelInfo, CredentialCheckResult } from '@meow-gateway/provider-core'

export interface WindowApi {
  listProviders(): Promise<ProviderWithCredential[]>
  createProvider(input: NewProviderInput): Promise<ProviderRow>
  updateProvider(id: string, patch: Partial<Omit<ProviderRow, 'id' | 'created_at'>>): Promise<ProviderRow>
  deleteProvider(id: string): Promise<boolean>
  setProviderCredential(id: string, secret: string): Promise<void>
  testProviderConnection(id: string): Promise<CredentialCheckResult>
  discoverModels(id: string): Promise<ModelInfo[]>
  listProviderTypes(): Promise<ProviderTypeDescriptor[]>
  listModelsByProvider(providerId: string): Promise<ModelRow[]>
  createModel(input: NewModel): Promise<ModelRow>
  updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): Promise<ModelRow>
  deleteModel(id: string): Promise<boolean>
  setModelEnabled(id: string, enabled: boolean): Promise<ModelRow>
  gatewayGetStatus(): Promise<GatewayStatus>
  gatewayStart(): Promise<GatewayStatus>
  gatewayStop(): Promise<GatewayStatus>
  gatewayGetConfig(): Promise<GatewayConfigRow>
  gatewaySaveConfig(cfg: NewGatewayConfig): Promise<GatewayConfigRow>
  gatewayGetKeyInfo(): Promise<GatewayKeyInfo>
  gatewayCopyKey(): Promise<void>
  gatewayRegenerateKey(): Promise<GatewayKeyInfo>
  usageDashboardTotals(): Promise<DashboardTotals>
  usageListRecent(limit: number): Promise<RequestUsageRow[]>
  usageListPage(page: number, pageSize: number): Promise<UsagePage>
  ping(): Promise<PingResult>
  listVirtualModels(): Promise<VirtualModelRow[]>
  getVirtualModel(id: string): Promise<VirtualModelRow | null>
  createVirtualModel(input: NewVirtualModelInput): Promise<VirtualModelRow>
  updateVirtualModel(id: string, patch: Partial<NewVirtualModelInput>): Promise<VirtualModelRow | null>
  deleteVirtualModel(id: string): Promise<boolean>
}

export const IPC_CHANNELS = {
  ping: 'app:ping',
  provider: {
    list: 'provider:list',
    create: 'provider:create',
    update: 'provider:update',
    delete: 'provider:delete',
    setCredential: 'provider:set-credential',
    testConnection: 'provider:test-connection',
    discoverModels: 'provider:discover-models',
    types: 'provider:types'
  },
  model: {
    listByProvider: 'model:list-by-provider',
    create: 'model:create',
    update: 'model:update',
    delete: 'model:delete',
    setEnabled: 'model:set-enabled'
  },
  gateway: {
    getStatus: 'gateway:get-status',
    start: 'gateway:start',
    stop: 'gateway:stop',
    getConfig: 'gateway:get-config',
    saveConfig: 'gateway:save-config',
    getKeyInfo: 'gateway:get-key-info',
    copyKey: 'gateway:copy-key',
    regenerateKey: 'gateway:regenerate-key'
  },
  usage: {
    dashboardTotals: 'usage:dashboard-totals',
    listRecent: 'usage:list-recent',
    listPage: 'usage:list-page'
  },
  virtualModel: {
    list: 'virtual-model:list',
    get: 'virtual-model:get',
    create: 'virtual-model:create',
    update: 'virtual-model:update',
    delete: 'virtual-model:delete'
  }
} as const

export type PingPayload = { from: string }
export type PingResult = { pong: string; echo: string }

// Input for creating/updating a virtual model. `id` is optional on create.
export interface NewVirtualModelInput {
  id?: string
  display_name: string
  provider_id: string
  provider_model_id: string
  routing_policy_id?: string | null
  enabled?: boolean
}

export interface NewProviderInput {
  type: string
  display_name: string
  base_url?: string | null
}

export type ProviderWithCredential = ProviderRow & { hasCredential: boolean }

export interface ProviderTypeDescriptor {
  id: string
  displayName: string
  defaultBaseUrl: string
  authType: string
}

export interface GatewayStatus {
  running: boolean
  host: string
  port: number
}

// What the renderer is allowed to know about the gateway key. The raw key is
// never part of this type — see docs/SECURITY.md.
export interface GatewayKeyInfo {
  masked: string
  present: boolean
}


export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: { message: string; code?: string }
}
