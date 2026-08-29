// Public exports for the provider-core package. This is the only shared contract
// across provider packages and the gateway. It has NO UI, NO SQLite, NO Electron
// dependencies — only pure TypeScript types + the registry + contract tests.

export type {
  ProviderContext,
  ProviderAdapter,
  ModelInfo,
  ModelCapabilities,
  CredentialCheckResult,
  NormalizedChatRequest,
  NormalizedMessage,
  NormalizedChatChunk,
  ToolCallDelta,
  UsageExtraction,
  ChatOptions,
  ProviderErrorInfo,
  GatewayErrorType
} from './types'
export { ProviderError, ERROR_TYPES } from './types'
export { ProviderRegistry } from './registry'
export { defineAdapterContractTests, accumulateText } from './contract'
export type { AdapterContractHost } from './contract'
