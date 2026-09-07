import type { OAuthClientConfig, OAuthTokenBundle } from './types'
import { OAuthTokenClient } from './tokenClient'
import type { OAuthTokenStore } from './tokenStore'

export class OAuthRefreshError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OAuthRefreshError'
    this.status = status
  }
}

export interface OAuthTokenManagerOptions {
  config: OAuthClientConfig
  store: OAuthTokenStore
  client?: OAuthTokenClient
  refreshGraceSec?: number
}

export class OAuthTokenManager {
  private readonly client: OAuthTokenClient
  private readonly refreshGraceMs: number

  constructor(private readonly opts: OAuthTokenManagerOptions) {
    this.client = opts.client ?? new OAuthTokenClient(opts.config)
    this.refreshGraceMs = (opts.refreshGraceSec ?? 300) * 1000
  }

  async getBundle(ref: string): Promise<OAuthTokenBundle | null> {
    return this.opts.store.get(ref)
  }

  async setBundle(ref: string, bundle: OAuthTokenBundle): Promise<void> {
    await this.opts.store.set(ref, bundle)
  }

  async deleteBundle(ref: string): Promise<void> {
    await this.opts.store.delete(ref)
  }

  async setBundleField(ref: string, patch: Partial<OAuthTokenBundle>): Promise<void> {
    const current = await this.opts.store.get(ref)
    if (!current) throw new OAuthRefreshError('No token bundle to patch.')
    await this.opts.store.set(ref, { ...current, ...patch })
  }

  async setProjectId(ref: string, projectId: string): Promise<void> {
    await this.setBundleField(ref, { projectId })
  }

  async getAccessToken(ref: string): Promise<string> {
    const bundle = await this.opts.store.get(ref)
    if (!bundle) throw new OAuthRefreshError('No OAuth account bound to this provider.')
    const now = Date.now()
    if (bundle.expiresAt > now + this.refreshGraceMs) {
      return bundle.accessToken
    }
    if (!bundle.refreshToken) {
      throw new OAuthRefreshError('OAuth access token expired and no refresh token is available.')
    }
    let pair
    try {
      pair = await this.client.refreshAccessToken(bundle.refreshToken)
    } catch (err) {
      const status = err instanceof Error && 'status' in err ? (err as { status?: number }).status : undefined
      throw new OAuthRefreshError('OAuth token refresh failed.', status)
    }
    const next: OAuthTokenBundle = {
      accessToken: pair.accessToken,
      refreshToken: bundle.refreshToken,
      tokenType: pair.tokenType || bundle.tokenType || 'Bearer',
      expiresAt: Date.now() + pair.expiresInSec * 1000,
      idToken: pair.idToken ?? bundle.idToken,
      oauthClientKey: pair.oauthClientKey ?? bundle.oauthClientKey,
      scope: bundle.scope,
      projectId: bundle.projectId
    }
    await this.opts.store.set(ref, next)
    return next.accessToken
  }
}
