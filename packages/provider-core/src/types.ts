// Provider-neutral types. Provider adapters implement ProviderAdapter;
// this package is the only shared contract across provider packages.

export interface ProviderContext {
  credentialRef: string
  // Resolved secret value (main-process only). Never exposed to the renderer.
  credential?: string
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
  toolCall?: ToolCallDelta
  finishReason?: string
  usage?: UsageExtraction
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

// Normalized provider error. Never includes raw secret/header material.
export interface ProviderErrorInfo {
  type: GatewayErrorType
  message: string
  status?: number
  providerCode?: string
  retryable?: boolean
  retryAfterMs?: number
}

export class ProviderError extends Error {
  readonly type: GatewayErrorType
  readonly status?: number
  readonly providerCode?: string
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(info: ProviderErrorInfo) {
    super(info.message)
    this.name = 'ProviderError'
    this.type = info.type
    this.status = info.status
    this.providerCode = info.providerCode
    this.retryable = info.retryable ?? false
    this.retryAfterMs = info.retryAfterMs
  }
}

// Tool-call delta carried in a streamed chunk.
export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  arguments?: string
}

// A usage / token accounting summary extracted from a provider response.
export interface UsageExtraction {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}

// Chat request may carry credential options; unused here but kept generic.
export interface ChatOptions {
  signal: AbortSignal
  requestId: string
}

export interface ProviderAdapter {
  id: string
  getModels(ctx: ProviderContext): Promise<ModelInfo[]>
  validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult>
  chat(
    ctx: ProviderContext,
    request: NormalizedChatRequest
  ): AsyncIterable<NormalizedChatChunk>
}
