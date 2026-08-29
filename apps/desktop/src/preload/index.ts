import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type PingPayload,
  type PingResult,
  type WindowApi,
  type NewVirtualModelInput,
  type NewProviderInput,
  type ProviderWithCredential,
  type ProviderTypeDescriptor,
  type GatewayStatus,
  type GatewayKeyInfo,
  type IpcResult,
  type DashboardTotals,
  type UsagePage
} from '../shared/ipc'
import type {
  VirtualModelRow,
  ProviderRow,
  ModelRow,
  GatewayConfigRow,
  RequestUsageRow,
  NewGatewayConfig,
  NewModel
} from '../main/database/types'
import type { ModelInfo, CredentialCheckResult } from '@meow-gateway/provider-core'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) {
    throw new Error(result.error?.message ?? 'IPC call failed')
  }
  return result.data as T
}

const api: WindowApi = {
  ping: async () => {
    const payload: PingPayload = { from: 'preload' }
    return ipcRenderer.invoke(IPC_CHANNELS.ping, payload) as Promise<PingResult>
  },
  getAppVersion: () => invoke<string>(IPC_CHANNELS.getAppVersion),
  listProviders: () => invoke<ProviderWithCredential[]>(IPC_CHANNELS.provider.list),
  createProvider: (input: NewProviderInput) => invoke<ProviderRow>(IPC_CHANNELS.provider.create, input),
  updateProvider: (id, patch) => invoke<ProviderRow>(IPC_CHANNELS.provider.update, id, patch),
  deleteProvider: (id) => invoke<boolean>(IPC_CHANNELS.provider.delete, id),
  setProviderCredential: (id, secret) => invoke<void>(IPC_CHANNELS.provider.setCredential, id, secret),
  testProviderConnection: (id) => invoke<CredentialCheckResult>(IPC_CHANNELS.provider.testConnection, id),
  discoverModels: (id) => invoke<ModelInfo[]>(IPC_CHANNELS.provider.discoverModels, id),
  listProviderTypes: () => invoke<ProviderTypeDescriptor[]>(IPC_CHANNELS.provider.types),
  listModelsByProvider: (providerId) => invoke<ModelRow[]>(IPC_CHANNELS.model.listByProvider, providerId),
  createModel: (input: NewModel) => invoke<ModelRow>(IPC_CHANNELS.model.create, input),
  updateModel: (id, patch) => invoke<ModelRow>(IPC_CHANNELS.model.update, id, patch),
  deleteModel: (id) => invoke<boolean>(IPC_CHANNELS.model.delete, id),
  setModelEnabled: (id, enabled) => invoke<ModelRow>(IPC_CHANNELS.model.setEnabled, id, enabled),
  gatewayGetStatus: () => invoke<GatewayStatus>(IPC_CHANNELS.gateway.getStatus),
  gatewayStart: () => invoke<GatewayStatus>(IPC_CHANNELS.gateway.start),
  gatewayStop: () => invoke<GatewayStatus>(IPC_CHANNELS.gateway.stop),
  gatewayGetConfig: () => invoke<GatewayConfigRow>(IPC_CHANNELS.gateway.getConfig),
  gatewaySaveConfig: (cfg: NewGatewayConfig) => invoke<GatewayConfigRow>(IPC_CHANNELS.gateway.saveConfig, cfg),
  gatewayGetKeyInfo: () => invoke<GatewayKeyInfo>(IPC_CHANNELS.gateway.getKeyInfo),
  gatewayCopyKey: () => invoke<void>(IPC_CHANNELS.gateway.copyKey),
  gatewayRegenerateKey: () => invoke<GatewayKeyInfo>(IPC_CHANNELS.gateway.regenerateKey),
  usageDashboardTotals: () => invoke<DashboardTotals>(IPC_CHANNELS.usage.dashboardTotals),
  usageListRecent: (limit) => invoke<RequestUsageRow[]>(IPC_CHANNELS.usage.listRecent, limit),
  usageListPage: (page, pageSize) => invoke<UsagePage>(IPC_CHANNELS.usage.listPage, page, pageSize),
  listVirtualModels: () => invoke<VirtualModelRow[]>(IPC_CHANNELS.virtualModel.list),
  getVirtualModel: (id) => invoke<VirtualModelRow | null>(IPC_CHANNELS.virtualModel.get, id),
  createVirtualModel: (input: NewVirtualModelInput) => invoke<VirtualModelRow>(IPC_CHANNELS.virtualModel.create, input),
  updateVirtualModel: (id, patch) => invoke<VirtualModelRow | null>(IPC_CHANNELS.virtualModel.update, id, patch),
  deleteVirtualModel: (id) => invoke<boolean>(IPC_CHANNELS.virtualModel.delete, id)
}

contextBridge.exposeInMainWorld('meowGateway', api)
