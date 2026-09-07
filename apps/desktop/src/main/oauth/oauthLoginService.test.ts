import { describe, it, expect } from 'vitest'
import { OAuthLoginService } from './oauthLoginService'
import type { ProviderService } from '../provider/providerService'
import type { OAuthTokenStore, OAuthTokenBundle } from '@meow-gateway/oauth-core'
import type { ProviderRow } from '../database/types'

const OAUTH_CLIENT = {
  clientId: 'c', clientSecret: 's', authUrl: 'https://a', tokenUrl: 'https://t', userInfoUrl: 'https://u', scopes: ['s1']
}

const DEFAULT_PROVIDER_SERVICE = {
  create: (input: { type: string; display_name: string }) =>
    ({ id: 'PROV_X', type: input.type, display_name: input.display_name, enabled: true, base_url: null, created_at: '', updated_at: '' } as ProviderRow),
  setCredential: async () => {},
  delete: async () => true,
  listWithCredential: async () => [],
} as unknown as ProviderService

function memStore(initial: Record<string, OAuthTokenBundle> = {}): OAuthTokenStore & { peek: (ref: string) => OAuthTokenBundle | null } {
  const data = new Map<string, OAuthTokenBundle>(Object.entries(initial))
  return {
    get: async (ref) => data.get(ref) ?? null,
    set: async (ref, b) => { data.set(ref, b) },
    delete: async (ref) => { data.delete(ref) },
    peek: (ref) => data.get(ref) ?? null
  }
}

function makeServer() {
  return {
    url: 'http://127.0.0.1:9/oauth-callback',
    redirectUri: 'http://127.0.0.1:9/oauth-callback',
    state: 'st',
    waitForCallback: async () => ({ code: 'CODE' })
  }
}

describe('OAuthLoginService', () => {
  it('listAccounts returns empty when no antigravity providers', async () => {
    const providerService = { ...DEFAULT_PROVIDER_SERVICE, listWithCredential: async () => [] } as unknown as ProviderService
    const client = {
      exchangeCode: async () => { throw new Error('n/a') },
      refreshAccessToken: async () => { throw new Error('n/a') },
      getUserInfo: async () => ({ id: 'u', email: '' })
    }
    const svc = new OAuthLoginService({
      providerService,
      tokenStore: memStore(),
      clientForType: () => OAUTH_CLIENT,
      tokenClientForType: () => client as never
    })
    const metas = await svc.listAccounts('antigravity')
    expect(metas).toEqual([])
  })

  it('completeLoginFor creates a provider, stores the bundle, and returns metadata', async () => {
    const created: ProviderRow[] = []
    const store = memStore()
    const providerService = {
      create: (input: { type: string; display_name: string }) => {
        const row = { id: 'PROV_X', type: input.type, display_name: input.display_name, enabled: true, base_url: null, created_at: '', updated_at: '' } as ProviderRow
        created.push(row)
        return row
      },
      setCredential: async (id: string, secret: string) => {
        await store.set(`provider:${id}`, JSON.parse(secret))
      },
      delete: async () => true,
      listWithCredential: async () => []
    } as unknown as ProviderService
    const client = {
      exchangeCode: async () => ({ accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresInSec: 3600 }),
      refreshAccessToken: async () => { throw new Error('n/a') },
      getUserInfo: async () => ({ id: 'u1', email: 'a@b.com', name: 'A B' })
    }
    const svc = new OAuthLoginService({
      providerService,
      tokenStore: store,
      clientForType: () => OAUTH_CLIENT,
      tokenClientForType: () => client as never
    })
    const meta = await svc.completeLoginFor('antigravity', makeServer())
    expect(meta.email).toBe('a@b.com')
    expect(meta.displayName).toBe('A B')
    expect(meta.valid).toBe(true)
    expect(created.length).toBe(1)
    expect(created[0].type).toBe('antigravity')
    expect(store.peek('provider:PROV_X')!.accessToken).toBe('AT')
  })

  it('logoutAccount deletes the credential and provider', async () => {
    let deletedProvider = false
    const store = memStore({ 'provider:PROV_X': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: 0 } })
    const providerService = {
      delete: async () => { deletedProvider = true; return true },
      create: DEFAULT_PROVIDER_SERVICE.create,
      setCredential: async () => {},
      listWithCredential: async () => []
    } as unknown as ProviderService
    const svc = new OAuthLoginService({
      providerService,
      tokenStore: store,
      clientForType: () => OAUTH_CLIENT
    })
    await svc.logoutAccount('PROV_X')
    expect(store.peek('provider:PROV_X')).toBeNull()
    expect(deletedProvider).toBe(true)
  })
})
