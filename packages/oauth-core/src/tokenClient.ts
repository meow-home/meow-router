import type { OAuthClientConfig, OAuthTokenPair, OAuthUserInfo } from './types'
import type { Fetcher } from './fetcher'
import { defaultFetcher } from './fetcher'

export class OAuthTokenClientError extends Error {
  readonly kind: 'network' | 'invalid_grant' | 'server' | 'response'
  readonly status?: number
  constructor(kind: OAuthTokenClientError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'OAuthTokenClientError'
    this.kind = kind
    this.status = status
  }
}

async function parseTokenPair(raw: unknown): Promise<OAuthTokenPair> {
  const r = raw as Partial<{
    access_token: unknown
    refresh_token?: unknown
    token_type?: unknown
    expires_in?: unknown
    id_token?: unknown
    scope?: unknown
  }>
  const accessToken = typeof r.access_token === 'string' ? r.access_token : ''
  const expiresInSec = typeof r.expires_in === 'number' ? r.expires_in : 3600
  if (!accessToken) {
    throw new OAuthTokenClientError('response', 'Token response missing access_token.')
  }
  return {
    accessToken,
    refreshToken: typeof r.refresh_token === 'string' ? r.refresh_token : undefined,
    tokenType: typeof r.token_type === 'string' ? r.token_type : 'Bearer',
    expiresInSec,
    idToken: typeof r.id_token === 'string' ? r.id_token : undefined,
    scope: typeof r.scope === 'string' ? r.scope : undefined
  }
}

function errorKind(status: number): 'invalid_grant' | 'server' {
  if (status === 400) return 'invalid_grant'
  return 'server'
}

export class OAuthTokenClient {
  private readonly fetcher: Fetcher
  constructor(
    private readonly config: OAuthClientConfig,
    fetcher?: Fetcher
  ) {
    this.fetcher = fetcher ?? defaultFetcher()
  }

  private async postForm(form: Record<string, string>): Promise<OAuthTokenPair> {
    try {
      const res = await this.fetcher(this.config.tokenUrl, {
        method: 'POST',
        form
      })
      if (!res.ok) {
        throw new OAuthTokenClientError(errorKind(res.status), `Token request failed (${res.status}).`, res.status)
      }
      return parseTokenPair(await res.json())
    } catch (err) {
      if (err instanceof OAuthTokenClientError) throw err
      throw new OAuthTokenClientError('network', 'Token request network error.')
    }
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    if (!this.config.userInfoUrl) {
      throw new OAuthTokenClientError('response', 'No userInfoUrl configured.')
    }
    try {
      const res = await this.fetcher(this.config.userInfoUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) {
        throw new OAuthTokenClientError('server', `Userinfo request failed (${res.status}).`, res.status)
      }
      const raw = (await res.json()) as Partial<{ id?: string; email?: string; name?: string; picture?: string }>
      return {
        id: typeof raw.id === 'string' ? raw.id : undefined,
        email: typeof raw.email === 'string' ? raw.email : '',
        name: typeof raw.name === 'string' ? raw.name : undefined,
        picture: typeof raw.picture === 'string' ? raw.picture : undefined
      }
    } catch (err) {
      if (err instanceof OAuthTokenClientError) throw err
      throw new OAuthTokenClientError('network', 'Userinfo network error.')
    }
  }
}
