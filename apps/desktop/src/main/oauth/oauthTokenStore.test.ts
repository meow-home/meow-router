import { describe, it, expect } from 'vitest'
import { SecureOAuthTokenStore } from './oauthTokenStore'
import type { CredentialService } from '../credentials/credentialService'
import type { OAuthTokenBundle } from '@meow-gateway/oauth-core'

function memCreds(): CredentialService {
  const map = new Map<string, string>()
  return {
    setCredential: async (r, s) => { map.set(r, s) },
    getCredential: async (r) => map.get(r) ?? null,
    deleteCredential: async (r) => { map.delete(r) },
    hasCredential: async (r) => map.has(r)
  }
}

describe('SecureOAuthTokenStore', () => {
  it('persists a bundle as JSON via the credential service', async () => {
    const creds = memCreds()
    const store = new SecureOAuthTokenStore(creds)
    const bundle: OAuthTokenBundle = { accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresAt: 123 }
    await store.set('provider.x', bundle)
    const raw = await creds.getCredential('provider.x')
    expect(JSON.parse(raw!).accessToken).toBe('a')
    const got = await store.get('provider.x')
    expect(got!.refreshToken).toBe('r')
  })

  it('returns null for missing or invalid JSON', async () => {
    const creds = memCreds()
    const store = new SecureOAuthTokenStore(creds)
    expect(await store.get('missing')).toBeNull()
    await creds.setCredential('bad', 'not-json')
    expect(await store.get('bad')).toBeNull()
  })
})
