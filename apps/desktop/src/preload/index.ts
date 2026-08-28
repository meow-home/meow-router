import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PingPayload, type PingResult, type WindowApi } from '../shared/ipc'

const api: WindowApi = {
  ping: async () => {
    const payload: PingPayload = { from: 'preload' }
    return ipcRenderer.invoke(IPC_CHANNELS.ping, payload) as Promise<PingResult>
  }
}

contextBridge.exposeInMainWorld('meowGateway', api)
