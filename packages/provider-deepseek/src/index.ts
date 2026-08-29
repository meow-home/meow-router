// Public exports for the DeepSeek provider package. Built on the OpenAI-compatible
// base with DeepSeek-specific metadata + capabilities. No UI/SQLite/Electron deps.

export { createDeepSeekAdapter, DeepSeekAdapter, mapDeepseekError } from './adapter'
export { deepseekMetadata, DEEPSEEK_MODELS, DEEPSEEK_CAPABILITIES } from './metadata'
