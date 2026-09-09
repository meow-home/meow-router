import {
  type Fetcher,
  defaultFetcher,
  type OAuthClientConfig,
  type OAuthTokenPair,
  type PkcePair
} from '@meow-gateway/oauth-core'

export class CodexTokenClientError extends Error {
  readonly kind: 'network' | 'invalid_grant' | 'server' | 'response'
  readonly status?: number
  constructor(kind: CodexTokenClientError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'CodexTokenClientError'
    this.kind = kind
    this.status = status
  }
}

export interface CodexTokenClientOptions {
  config: OAuthClientConfig
  fetcher?: Fetcher
}

function parsePair(raw: unknown): OAuthTokenPair {
  const r = raw as Partial<{ access_token: unknown; refresh_token?: unknown; token_type?: unknown; expires_in?: unknown; id_token?: unknown; scope?: unknown }>
  const accessToken = typeof r.access_token === 'string' ? r.access_token : ''
  const expiresInSec = typeof r.expires_in === 'number' ? r.expires_in : 3600
  if (!accessToken) throw new CodexTokenClientError('response', 'Token response missing access_token.')
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
  return status === 400 ? 'invalid_grant' : 'server'
}

/** PKCE token client for auth.openai.com. No client_secret; uses code_verifier. */
export class CodexTokenClient {
  private readonly fetcher: Fetcher
  constructor(private readonly config: OAuthClientConfig, fetcher?: Fetcher) {
    this.fetcher = fetcher ?? defaultFetcher()
  }

  private async postForm(form: Record<string, string>): Promise<OAuthTokenPair> {
    try {
      const res = await this.fetcher(this.config.tokenUrl, { method: 'POST', form })
      if (!res.ok) {
        throw new CodexTokenClientError(errorKind(res.status), `Token request failed (${res.status}).`, res.status)
      }
      return parsePair(await res.json())
    } catch (err) {
      if (err instanceof CodexTokenClientError) throw err
      throw new CodexTokenClientError('network', 'Token request network error.')
    }
  }

  async exchangeCode(code: string, pkcePair: PkcePair, redirectUri: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: pkcePair.codeVerifier
    })
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  }
}
