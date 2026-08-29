// Provider metadata for OpenAI-compatible endpoints. Kept provider-neutral in
// the sense that it describes a category of providers (OpenAI, OpenRouter, etc.)
// rather than a single vendor. DeepSeek's provider package extends this.

export interface ProviderMetadata {
  id: string
  displayName: string
  defaultBaseUrl: string
  authType: 'bearer' // OpenAI-compatible uses Bearer API key auth
}

export const openaiCompatibleMetadata: ProviderMetadata = {
  id: 'openai-compatible',
  displayName: 'OpenAI-Compatible',
  defaultBaseUrl: 'https://api.openai.com/v1',
  authType: 'bearer'
}
