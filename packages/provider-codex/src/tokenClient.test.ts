import { describe, it, expect } from 'vitest'
import { CodexTokenClient } from './tokenClient'
import type { Fetcher, PkcePair } from '@meow-gateway/oauth-core'
import { CODEX_OAUTH_CLIENT } from './metadata'

const PAIR: PkcePair = { codeVerifier: 'v'.repeat(43), codeChallenge: 'ch' }
const REDIRECT = 'http://127.0.0.1:1455/oauth-callback'

describe('CodexTokenClient', () => {
  it('exchangeCode sends PKCE form fields (no client_secret) and parses the pair', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) }
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '',
        json: async () => ({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600, id_token: 'id' })
      }
    }
    const client = new CodexTokenClient(CODEX_OAUTH_CLIENT, fetcher)
    const pair = await client.exchangeCode('CODE', PAIR, REDIRECT)
    expect(captured.grant_type).toBe('authorization_code')
    expect(captured.code).toBe('CODE')
    expect(captured.redirect_uri).toBe(REDIRECT)
    expect(captured.client_id).toBe(CODEX_OAUTH_CLIENT.clientId)
    expect(captured.code_verifier).toBe(PAIR.codeVerifier)
    expect('client_secret' in captured).toBe(false)
    expect(pair.accessToken).toBe('at')
    expect(pair.refreshToken).toBe('rt')
    expect(pair.expiresInSec).toBe(3600)
    expect(pair.idToken).toBe('id')
  })

  it('refreshAccessToken sends client_id + refresh_token (no secret)', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ access_token: 'at2', token_type: 'Bearer', expires_in: 300 }) }
    }
    const client = new CodexTokenClient(CODEX_OAUTH_CLIENT, fetcher)
    const pair = await client.refreshAccessToken('RT')
    expect(captured.grant_type).toBe('refresh_token')
    expect(captured.refresh_token).toBe('RT')
    expect(captured.client_id).toBe(CODEX_OAUTH_CLIENT.clientId)
    expect('client_secret' in captured).toBe(false)
    expect(pair.accessToken).toBe('at2')
  })

  it('maps a 400 to an invalid_grant error', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 400, headers: { get: () => '' }, text: async () => '{}', json: async () => ({}) })
    const client = new CodexTokenClient(CODEX_OAUTH_CLIENT, fetcher)
    await expect(client.exchangeCode('C', PAIR, REDIRECT)).rejects.toMatchObject({ kind: 'invalid_grant', status: 400 })
  })
})
