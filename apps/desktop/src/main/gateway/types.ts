// Gateway dependency contract.
//
// The gateway server is dependency-injected so it is fully testable offline and
// never couples to SQLite, Electron, or any specific provider directly. The main
// process wires real implementations; tests inject fakes.

import type { ProviderRegistry, ModelInfo } from '@meow-gateway/provider-core'

// A model resolved from a client-visible model id (virtual model in later phases).
export interface ResolvedModel {
  providerId: string
  providerModelId: string
  model: ModelInfo
}

// Usage sent to the recorder after a completed or failed request.
export interface GatewayUsage {
  requestId: string
  virtualModelId: string
  providerId: string
  providerModelId: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  latencyMs: number
  status: 'success' | 'error' | 'aborted'
  errorCode?: string
}

export interface GatewayLogger {
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

// Minimal logger (no-op) used by default.
export const nullLogger: GatewayLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

export interface GatewayDependencies {
  registry: ProviderRegistry
  // Resolve an opaque credential ref to its secret in the main process. Returns
  // null if the credential is not found. Never exposed to the renderer.
  getCredential(ref: string): Promise<string | null>
  // Resolve a client-visible model id to a provider + provider model. Returns
  // null when the model is unknown (-> MODEL_NOT_FOUND).
  resolveModel(model: string): Promise<ResolvedModel | null>
  // Record request usage (Phase 5). Optional; defaults to a no-op.
  recordUsage?(usage: GatewayUsage): Promise<void>
  // List client-visible models for GET /v1/models. Optional; defaults to [].
  listModels?(): Promise<Array<{ id: string; object: string; owned_by: string }>>
  logger?: GatewayLogger
}
