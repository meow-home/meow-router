// Narrow typed IPC contract shared between preload, main, and renderer.
// Only non-sensitive, schema-validated payloads cross this boundary.

export interface WindowApi {
  ping(): Promise<PingResult>
}

export const IPC_CHANNELS = {
  ping: 'app:ping'
} as const

export type PingPayload = { from: string }
export type PingResult = { pong: string; echo: string }
