// DeepSeek provider metadata. DeepSeek exposes an OpenAI-compatible API, so the
// adapter is built on the OpenAI-compatible base with DeepSeek-specific metadata
// (default base URL, known model capabilities) and error mapping.

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

export const deepseekMetadata = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  defaultBaseUrl: DEEPSEEK_BASE_URL,
  authType: 'bearer' as const
}

// Known DeepSeek model capabilities (discovered models may extend this).
export const DEEPSEEK_CAPABILITIES = {
  'deepseek-chat': { streaming: true, tools: true, vision: false, reasoning: true, structuredOutput: false },
  'deepseek-reasoner': { streaming: true, tools: false, vision: false, reasoning: true, structuredOutput: false }
} as const

// DeepSeek-specific model discovery: a static known model list plus any dynamic
// models from the API. Keeps the adapter deterministic in tests.
export const DEEPSEEK_MODELS: { id: string; displayName: string }[] = [
  { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
  { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' }
]
