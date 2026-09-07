import { describe, it, expect } from 'vitest'
import { OAuthTokenClient } from './tokenClient'
import type { Fetcher } from './fetcher'

const CONFIG = {
  clientId: 'c', clientSecret: 's',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform']
}
const REDIRECT = 'http://127.0.0.1:54321/oauth-callback'

describe('OAuthTokenClient', () => {
  it('exchangeCode POSTs form fields and returns a token pair with expiresInSec', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) }
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '',
        json: async () => ({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3599, id_token: 'id' }),
        form: init?.form
      }
    }
    const client = new OAuthTokenClient(CONFIG, fetcher)
    const pair = await client.exchangeCode('CODE', REDIRECT)
    expect(captured.grant_type).toBe('authorization_code')
    expect(captured.code).toBe('CODE')
    expect(captured.redirect_uri).toBe(REDIRECT)
    expect(captured.client_id).toBe('c')
    expect(captured.client_secret).toBe('s')
    expect(pair.accessToken).toBe('at')
    expect(pair.refreshToken).toBe('rt')
    expect(pair.expiresInSec).toBe(3599)
  })

  it('refreshAccessToken POSTs grant_type=refresh_token', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) }
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '',
        json: async () => ({ access_token: 'at2', token_type: 'Bearer', expires_in: 300 }),
        form: init?.form
      }
    }
    const client = new OAuthTokenClient(CONFIG, fetcher)
    const pair = await client.refreshAccessToken('RT')
    expect(captured.grant_type).toBe('refresh_token')
    expect(captured.refresh_token).toBe('RT')
    expect(pair.accessToken).toBe('at2')
  })

  it('getUserInfo uses Bearer header and returns email', async () => {
    let authHeader = ''
    const fetcher: Fetcher = async (_url, init) => {
      authHeader = init?.headers?.['Authorization'] ?? ''
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '',
        json: async () => ({ id: 'u1', email: 'a@b.com', name: 'A' })
      }
    }
    const client = new OAuthTokenClient(CONFIG, fetcher)
    const info = await client.getUserInfo('AT')
    expect(authHeader).toBe('Bearer AT')
    expect(info.email).toBe('a@b.com')
  })

  it('maps invalid_grant exchange to kind=invalid_grant', async () => {
    const fetcher: Fetcher = async () => ({
      ok: false, status: 400,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
      json: async () => ({ error: 'invalid_grant' })
    })
    const client = new OAuthTokenClient(CONFIG, fetcher)
    await expect(client.exchangeCode('X', REDIRECT)).rejects.toMatchObject({ kind: 'invalid_grant' })
  })
})
