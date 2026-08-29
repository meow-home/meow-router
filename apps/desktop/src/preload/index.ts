import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type PingPayload,
  type PingResult,
  type WindowApi,
  type NewVirtualModelInput,
  type IpcResult
} from '../shared/ipc'
import type { VirtualModelRow } from '../main/database/types'

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
  listVirtualModels: () => invoke<VirtualModelRow[]>(IPC_CHANNELS.virtualModel.list),
  getVirtualModel: (id) => invoke<VirtualModelRow | null>(IPC_CHANNELS.virtualModel.get, id),
  createVirtualModel: (input: NewVirtualModelInput) => invoke<VirtualModelRow>(IPC_CHANNELS.virtualModel.create, input),
  updateVirtualModel: (id, patch) => invoke<VirtualModelRow | null>(IPC_CHANNELS.virtualModel.update, id, patch),
  deleteVirtualModel: (id) => invoke<boolean>(IPC_CHANNELS.virtualModel.delete, id)
}

contextBridge.exposeInMainWorld('meowGateway', api)
