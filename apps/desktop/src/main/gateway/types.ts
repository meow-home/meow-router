// Gateway dependency contract.
//
// The gateway server is dependency-injected so it is fully testable offline and
// never couples to SQLite, Electron, or any specific provider directly. The main
// process wires real implementations; tests inject fakes.

import type { AuthPolicy } from './auth'
import type { ProviderRegistry, ModelInfo } from '@meow-gateway/provider-core'

// A model resolved from a client-visible model id (virtual model in later phases).
export interface ResolvedModel {
  providerId: string
  providerModelId: string
  // The provider's configured endpoint. Without it the adapter falls back to
  // its own default and a request meant for one vendor is sent to another.
  baseUrl?: string
  // Registry key of the provider adapter, normally the provider's `type`
  // (e.g. 'deepseek'). Distinct from providerId, which is the DB UUID that
  // keys the credential ref and model-pricing lookups. The adapter registry is
  // keyed by type, so looking it up by the UUID throws and surfaces as
  // INTERNAL_ERROR.
  adapterId?: string
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
  // Ordinal (0-based) of the routing candidate this record belongs to.
  routeAttempt?: number
}

// One candidate route to attempt for a virtual model.
export interface RouteCandidate {
  providerId: string
  providerModelId: string
  baseUrl?: string
  // Registry key of the provider adapter (the provider's `type`). See
  // ResolvedModel.adapterId — providerId is the DB UUID, not the registry key.
  adapterId?: string
}

// An ordered list of routes (primary first). Loop prevented by the resolver.
export interface RouteList {
  routes: RouteCandidate[]
  usedFallback: boolean
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
  // Resolve an ordered list of candidate routes (primary first) for a virtual
  // model id. Optional; when absent the gateway treats the model as a single
  // primary route (no fallback).
  resolveRoutes?(id: string): Promise<RouteList>
  // Record request usage (Phase 5). Optional; defaults to a no-op.
  recordUsage?(usage: GatewayUsage): Promise<void>
  // List client-visible models for GET /v1/models. Optional; defaults to [].
  listModels?(): Promise<Array<{ id: string; object: string; owned_by: string }>>
  // Resolve the current auth policy. Optional: when absent the gateway treats
  // auth as disabled. Bootstrap always supplies it.
  getAuthPolicy?(): Promise<AuthPolicy>
  logger?: GatewayLogger
}
