// Public exports for the OpenAI-compatible provider package.
// These packages depend only on provider-core and never on UI/SQLite/Electron.

export { createOpenAICompatibleAdapter } from './openaiAdapter'
export { openaiCompatibleMetadata, OPENAI_COMPATIBLE_ID } from './metadata'
export type { ProviderMetadata } from './metadata'
export type { Fetcher, FetcherResponse } from './http'
