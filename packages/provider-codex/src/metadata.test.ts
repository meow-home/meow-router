import { describe, it, expect } from 'vitest'
import { CODEX_OAUTH_CLIENT } from './metadata'

describe('CODEX_OAUTH_CLIENT.buildAuthUrl', () => {
  it('wraps the raw authorize URL in the hosted desktop-auth endpoint', () => {
    const url = CODEX_OAUTH_CLIENT.buildAuthUrl!({
      clientId: CODEX_OAUTH_CLIENT.clientId,
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
      scope: CODEX_OAUTH_CLIENT.scopes.join(' '),
      state: 'abc123',
      codeChallenge: 'challenge-value'
    })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://chatgpt.com/codex/desktop-auth')
    expect(parsed.searchParams.get('codex_streamlined_login')).toBe('true')
    expect(parsed.searchParams.get('no_universal_links')).toBe('1')

    const raw = new URL(parsed.searchParams.get('authorize_url')!)
    expect(raw.origin + raw.pathname).toBe('https://auth.openai.com/oauth/authorize')
    expect(raw.searchParams.get('client_id')).toBe(CODEX_OAUTH_CLIENT.clientId)
    expect(raw.searchParams.get('response_type')).toBe('code')
    expect(raw.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(raw.searchParams.get('scope')).toContain('api.connectors.invoke')
    expect(raw.searchParams.get('state')).toBe('abc123')
    expect(raw.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(raw.searchParams.get('code_challenge_method')).toBe('S256')
    // Codex-specific params required by OpenAI's auth server.
    expect(raw.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(raw.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(raw.searchParams.get('codex_streamlined_login')).toBe('true')
    expect(raw.searchParams.get('originator')).toBe('Codex Desktop')
    expect(raw.searchParams.get('codex_app_version')).toBeTruthy()
    expect(raw.searchParams.get('source_surface_stable_id')).toBeTruthy()
    expect(raw.searchParams.get('codex_origin_stable_id')).toBeTruthy()
  })

  it('omits code_challenge when PKCE is not supplied', () => {
    const url = CODEX_OAUTH_CLIENT.buildAuthUrl!({
      clientId: CODEX_OAUTH_CLIENT.clientId,
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
      scope: CODEX_OAUTH_CLIENT.scopes.join(' '),
      state: 'abc123'
    })
    const parsed = new URL(url)
    const raw = new URL(parsed.searchParams.get('authorize_url')!)
    expect(raw.searchParams.get('code_challenge')).toBeNull()
  })
})
