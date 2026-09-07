import { shell } from 'electron'
import { OAuthTokenClient, type OAuthClientConfig, type OAuthTokenBundle, type OAuthTokenStore, prepareAuth, type PreparedAuth } from '@meow-gateway/oauth-core'
import type { ProviderService } from '../provider/providerService'
import type { CredentialService } from '../credentials/credentialService'

export interface OAuthAccountMeta {
  providerId: string
  email: string
  displayName: string
  expiresAt: number
  valid: boolean
}

export interface OAuthLoginStart {
  pending: boolean
  redirectUri: string
}

export interface OAuthLoginServiceDeps {
  providerService: ProviderService
  credentials: CredentialService
  tokenStore: OAuthTokenStore
  clientForType: (type: string) => OAuthClientConfig
  /** Optional so tests can inject a fresh OAuthTokenClient. */
  tokenClientForType?: (type: string) => OAuthTokenClient
}

function credentialRefFor(providerId: string): string {
  return `provider:${providerId}`
}

export class OAuthLoginService {
  private readonly providerService: ProviderService
  private readonly credentials: CredentialService
  private readonly tokenStore: OAuthTokenStore
  private readonly clientForType: (type: string) => OAuthClientConfig
  private readonly tokenClientForType?: (type: string) => OAuthTokenClient
  private pending?: { type: string; prepared: PreparedAuth }

  constructor(deps: OAuthLoginServiceDeps) {
    this.providerService = deps.providerService
    this.credentials = deps.credentials
    this.tokenStore = deps.tokenStore
    this.clientForType = deps.clientForType
    this.tokenClientForType = deps.tokenClientForType
  }

  async startLogin(type: string): Promise<OAuthLoginStart> {
    const config = this.clientForType(type)
    // Starts a local loopback callback server and builds the auth URL. The
    // browser is opened here; the exchange happens in completeLogin.
    const prepared = await prepareAuth({ config })
    this.pending = { type, prepared }
    await shell.openExternal(prepared.url)
    return { pending: true, redirectUri: prepared.redirectUri! }
  }

  async completeLogin(type: string): Promise<OAuthAccountMeta> {
    const pending = this.pending
    if (!pending) throw new Error('No pending OAuth login.')
    if (pending.type !== type) throw new Error(`Pending login is for provider type: ${pending.type}`)
    this.pending = undefined
    return this.completeLoginFor(type, pending.prepared)
  }

  async completeLoginFor(type: string, prepared: PreparedAuth): Promise<OAuthAccountMeta> {
    const config = this.clientForType(type)
    const { code } = await prepared.waitForCallback()
    const client = this.tokenClientForType ? this.tokenClientForType(type) : new OAuthTokenClient(config)
    const pair = await client.exchangeCode(code, prepared.redirectUri!)
    const user = await client.getUserInfo(pair.accessToken)

    const displayName = user.name ?? user.email
    const row = this.providerService.create({ type, display_name: displayName })
    const bundle: OAuthTokenBundle = {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken ?? '',
      tokenType: pair.tokenType || 'Bearer',
      expiresAt: Date.now() + pair.expiresInSec * 1000,
      idToken: pair.idToken,
      scope: pair.scope
    }
    // Store the bundle at the gateway credential ref (`provider:<id>`) so the
    // gateway and OAuthTokenManager both read the account from the OS secure
    // store. setCredential also creates the account row (1 provider = 1 account).
    await this.providerService.setCredential(row.id, JSON.stringify(bundle))
    await this.tokenStore.set(credentialRefFor(row.id), bundle)

    return {
      providerId: row.id,
      email: user.email,
      displayName,
      expiresAt: bundle.expiresAt,
      valid: true
    }
  }

  async listAccounts(type: string): Promise<OAuthAccountMeta[]> {
    const providers = await this.providerService.listWithCredential()
    const metas: OAuthAccountMeta[] = []
    for (const p of providers) {
      if (p.type !== type) continue
      const bundle = await this.tokenStore.get(credentialRefFor(p.id)).catch(() => null)
      metas.push({
        providerId: p.id,
        email: p.display_name,
        displayName: p.display_name,
        expiresAt: bundle?.expiresAt ?? 0,
        valid: !!bundle
      })
    }
    return metas
  }

  async logoutAccount(providerId: string): Promise<void> {
    // Best-effort revoke of the account: delete the provider (cascades its
    // account/model rows) and clear the secure-store bundle.
    await this.tokenStore.delete(credentialRefFor(providerId)).catch(() => {})
    await this.providerService.delete(providerId).catch(() => {})
  }
}
