import type { OAuthAuthorizeParams, OAuthClientConfig } from '@meow-gateway/oauth-core'

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

// Hosted auth wrapper used by the official Codex desktop client. The raw
// authorize URL is embedded as `authorize_url`; OpenAI's auth server requires
// these extra params or it rejects the request with "Invalid authorize
// request". Mirrors cockpit-tools codex_oauth.rs build_auth_url + hosted_auth_url.
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_HOSTED_AUTH_ENDPOINT = 'https://chatgpt.com/codex/desktop-auth'
const CODEX_APP_VERSION = '26.820.60940'
const CODEX_STABLE_ID = '00000000-0000-0000-0000-000000000000'

function codexBuildAuthUrl(params: OAuthAuthorizeParams): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope,
    state: params.state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    codex_streamlined_login: 'true',
    originator: CODEX_ORIGINATOR_HEADER,
    codex_app_version: CODEX_APP_VERSION,
    source_surface_stable_id: CODEX_STABLE_ID,
    codex_origin_stable_id: CODEX_STABLE_ID
  })
  if (params.codeChallenge) {
    query.set('code_challenge', params.codeChallenge)
    query.set('code_challenge_method', 'S256')
  }
  const raw = `${CODEX_AUTH_URL}?${query.toString()}`
  return `${CODEX_HOSTED_AUTH_ENDPOINT}?authorize_url=${encodeURIComponent(raw)}&codex_streamlined_login=true&no_universal_links=1`
}

// Public PKCE OAuth client for the Codex desktop app. clientId is a public
// (non-secret) PKCE client identifier with NO client_secret. Mirrors
// cockpit-tools codex_oauth.rs. This is intentionally NOT a provider secret.
export const CODEX_OAUTH_CLIENT: OAuthClientConfig = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  clientSecret: '',
  authUrl: CODEX_AUTH_URL,
  tokenUrl: 'https://auth.openai.com/oauth/token',
  userInfoUrl: undefined, // Codex has no userinfo endpoint; decode id_token instead
  pkce: true, // public client (no client_secret) → RFC 7636 required
  buildAuthUrl: codexBuildAuthUrl,
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'api.connectors.read', 'api.connectors.invoke'
  ]
}
