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

export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  userInfoUrl?: string
  scopes: string[]
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
