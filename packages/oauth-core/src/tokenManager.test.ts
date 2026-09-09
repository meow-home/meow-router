import { describe, it, expect } from 'vitest'
import { OAuthTokenManager } from './tokenManager'
import type { OAuthTokenStore } from './tokenStore'
import { OAuthTokenClient } from './tokenClient'
import type { OAuthClientConfig, OAuthTokenBundle } from './types'

const CONFIG: OAuthClientConfig = {
  clientId: 'c', clientSecret: 's',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['openid']
}

function memoryStore(initial: Record<string, OAuthTokenBundle> = {}): OAuthTokenStore & { get: (ref: string) => Promise<OAuthTokenBundle | null> } {
  const data = new Map<string, OAuthTokenBundle>(Object.entries(initial))
  return {
    get: async (ref) => data.get(ref) ?? null,
    set: async (ref, b) => { data.set(ref, b) },
    delete: async (ref) => { data.delete(ref) }
  }
}

describe('OAuthTokenManager', () => {
  it('returns cached accessToken when not near expiry', async () => {
    const store = memoryStore({
      'r:1': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: Date.now() + 10_000_000 }
    })
    const mgr = new OAuthTokenManager({ config: CONFIG, store, refreshGraceSec: 300 })
    expect(await mgr.getAccessToken('r:1')).toBe('AT')
  })

  it('refreshes when near expiry and persists a new bundle keeping projectId', async () => {
    let refreshed = false
    let capturedRefresh = ''
    const store = memoryStore({
      'r:1': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: Date.now() - 1000, projectId: 'proj-1' }
    })
    const client = {
      exchangeCode: async () => { throw new Error('n/a') },
      refreshAccessToken: async (rt: string) => { refreshed = true; capturedRefresh = rt; return { accessToken: 'AT2', tokenType: 'Bearer', expiresInSec: 3600 } },
      getUserInfo: async () => ({ id: 'u', email: 'a@b.com' })
    } as unknown as OAuthTokenClient
    const mgr = new OAuthTokenManager({ config: CONFIG, store, client, refreshGraceSec: 300 })
    expect(await mgr.getAccessToken('r:1')).toBe('AT2')
    expect(refreshed).toBe(true)
    expect(capturedRefresh).toBe('RT')
    const saved = await store.get('r:1')
    expect(saved!.accessToken).toBe('AT2')
    expect(saved!.projectId).toBe('proj-1')
    expect(saved!.refreshToken).toBe('RT')
  })

  it('persists projectId without overwriting the access token', async () => {
    const store = memoryStore({ 'r:1': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 } })
    const mgr = new OAuthTokenManager({ config: CONFIG, store })
    await mgr.setProjectId('r:1', 'PROJ-X')
    const saved = await store.get('r:1')
    expect(saved!.projectId).toBe('PROJ-X')
    expect(saved!.accessToken).toBe('AT')
  })

  it('throws when token expired and no refresh token exists', async () => {
    const store = memoryStore({ 'r:1': { accessToken: 'AT', refreshToken: '', tokenType: 'Bearer', expiresAt: Date.now() - 1000 } })
    const mgr = new OAuthTokenManager({ config: CONFIG, store })
    await expect(mgr.getAccessToken('r:1')).rejects.toThrow(/expired/i)
  })

  it('refreshes via an injected client that is structurally compatible (PKCE, no secret)', async () => {
    const store = memoryStore({ 'r:1': { accessToken: 'old', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() - 1000 } })
    const refreshCalls: string[] = []
    const client = {
      refreshAccessToken: async (rt: string) => {
        refreshCalls.push(rt)
        return { accessToken: 'new', refreshToken: 'rt', tokenType: 'Bearer', expiresInSec: 300 }
      }
    }
    const manager = new OAuthTokenManager({
      config: { ...CONFIG, clientSecret: '' },
      store,
      client: client as any,
      refreshGraceSec: 0
    })
    const token = await manager.getAccessToken('r:1')
    expect(token).toBe('new')
    expect(refreshCalls).toEqual(['rt'])
    expect((await store.get('r:1'))!.accessToken).toBe('new')
  })
})
