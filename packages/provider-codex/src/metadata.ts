import type { OAuthClientConfig } from '@meow-gateway/oauth-core'

export interface CodexMetadata {
  id: string
  displayName: string
  defaultBaseUrl: string
  fallbackBaseUrls: string[]
  authType: 'oauth'
}

export const CODEX_BASE_URLS: string[] = [
  'https://api.openai.com',
  'https://api.openai.com'
]

export const codexMetadata: CodexMetadata = {
  id: 'codex',
  displayName: 'Codex (OpenAI)',
  defaultBaseUrl: CODEX_BASE_URLS[0],
  fallbackBaseUrls: [],
  authType: 'oauth'
}

/** Header sent on OpenAI API calls using the OAuth identity. No credential. */
export const CODEX_ORIGINATOR_HEADER = 'Codex Desktop'

// Public PKCE OAuth client for the Codex desktop app. clientId is a public
// (non-secret) PKCE client identifier with NO client_secret. Mirrors
// cockpit-tools codex_oauth.rs. This is intentionally NOT a provider secret.
export const CODEX_OAUTH_CLIENT: OAuthClientConfig = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  clientSecret: '',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  userInfoUrl: undefined, // Codex has no userinfo endpoint; decode id_token instead
  pkce: true, // public client (no client_secret) → RFC 7636 required
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'api.connectors.read', 'api.connectors.invoke'
  ]
}
