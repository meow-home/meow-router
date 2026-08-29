// Narrow typed IPC contract shared between preload, main, and renderer.
// Only non-sensitive, schema-validated payloads cross this boundary.

import type { VirtualModelRow } from '../main/database/types'

export interface WindowApi {
  ping(): Promise<PingResult>
  listVirtualModels(): Promise<VirtualModelRow[]>
  getVirtualModel(id: string): Promise<VirtualModelRow | null>
  createVirtualModel(input: NewVirtualModelInput): Promise<VirtualModelRow>
  updateVirtualModel(id: string, patch: Partial<NewVirtualModelInput>): Promise<VirtualModelRow | null>
  deleteVirtualModel(id: string): Promise<boolean>
}

export const IPC_CHANNELS = {
  ping: 'app:ping',
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

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: { message: string; code?: string }
}
