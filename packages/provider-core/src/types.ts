// Provider-neutral types. Provider adapters implement ProviderAdapter;
// this package is the only shared contract across provider packages.

export interface ProviderContext {
  credentialRef: string
  baseUrl?: string
  signal: AbortSignal
  requestId: string
}

export interface ModelInfo {
  id: string
  providerModelId: string
  displayName: string
  contextWindow?: number
  inputPrice?: number
  outputPrice?: number
  capabilities: ModelCapabilities
}

export interface ModelCapabilities {
  streaming: boolean
  tools: boolean
  vision: boolean
  reasoning: boolean
  structuredOutput: boolean
}

export interface CredentialCheckResult {
  ok: boolean
  message: string
}

export interface NormalizedChatRequest {
  model: string
  messages: NormalizedMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
  tools?: unknown[]
  toolChoice?: unknown
  responseFormat?: unknown
}

export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  toolCallId?: string
}

export interface NormalizedChatChunk {
  id: string
  kind: 'content_delta' | 'tool_call_delta' | 'finish'
  delta?: string
  toolCallIndex?: number
  finishReason?: string
}

export const ERROR_TYPES = [
  'CLIENT_ERROR',
  'AUTH_ERROR',
  'RATE_LIMIT',
  'PROVIDER_UNAVAILABLE',
  'MODEL_NOT_FOUND',
  'REQUEST_REJECTED',
  'TIMEOUT',
  'STREAM_ERROR',
  'INTERNAL_ERROR'
] as const

export type GatewayErrorType = (typeof ERROR_TYPES)[number]

export interface ProviderAdapter {
  id: string
  getModels(ctx: ProviderContext): Promise<ModelInfo[]>
  validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult>
  chat(
    ctx: ProviderContext,
    request: NormalizedChatRequest
  ): AsyncIterable<NormalizedChatChunk>
}
