export interface OAuthTokenBundle {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: number            // epoch ms
  idToken?: string
  oauthClientKey?: string
  scope?: string
  projectId?: string           // Antigravity: resolved lazily, cached by the adapter
}

export interface OAuthAuthorizeParams {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  /** Present when PKCE is enabled. */
  codeChallenge?: string
}

export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  userInfoUrl?: string
  scopes: string[]
  /** RFC 7636 PKCE. Required for public clients (no client_secret). */
  pkce?: boolean
  /**
   * Optional provider-specific authorize-URL builder. When set it fully
   * controls the query params (and any URL wrapping) for the authorize URL,
   * so providers with non-standard endpoints (e.g. Codex's hosted auth) can
   * supply their own construction. Falls back to the generic builder.
   */
  buildAuthUrl?: (params: OAuthAuthorizeParams) => string
  /**
   * Optional local callback server configuration. Providers whose auth server
   * registers a fixed redirect URI (e.g. Codex: `http://localhost:1455/auth/callback`)
   * must set this so the redirect_uri matches exactly; otherwise the auth
   * server rejects the request.
   */
  callback?: {
    host?: string
    port?: number
    path?: string
    /** Host used in the redirect_uri; defaults to `host`. */
    redirectHost?: string
  }
}

export interface OAuthUserInfo {
  id?: string
  email: string
  name?: string
  picture?: string
}

// Raw response from POST tokenUrl (exchange or refresh). `expiresInSec` is the
// OAuth `expires_in` field; callers translate it to `expiresAt` (ms).
export interface OAuthTokenPair {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresInSec: number
  idToken?: string
  oauthClientKey?: string
  scope?: string
}
