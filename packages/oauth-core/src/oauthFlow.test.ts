import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareAuth, runAuthFlow, type PreparedAuth } from './oauthFlow'

const CONFIG = {
  clientId: 'cid',
  clientSecret: 'cs',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform']
}

const TOKEN_RESPONSE = {
  access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600
}
const USERINFO = { id: 'u1', email: 'a@b.com', name: 'A' }

const realFetch = fetch.bind(globalThis)

async function fakeFetch(url: string | URL | Request, init?: RequestInit) {
  const target = String(url)
  if (target.startsWith('http://127.0.0.1')) {
    return realFetch(target, init) // let real server handle the local callback
  }
  if (target.includes('/token')) {
    return new Response(JSON.stringify(TOKEN_RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } }) as unknown as Response
  }
  if (target.includes('userinfo')) {
    return new Response(JSON.stringify(USERINFO), { status: 200, headers: { 'content-type': 'application/json' } }) as unknown as Response
  }
  throw new Error(`Unexpected fetch: ${target}`)
}

afterEach(() => vi.unstubAllGlobals())

describe('prepareAuth', () => {
  it('builds a serverless auth URL with scopes and state', async () => {
    vi.stubGlobal('fetch', fakeFetch)
    const prepared: PreparedAuth = await prepareAuth({ config: CONFIG, serverless: true })
    const url = new URL(prepared.url)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toContain('cloud-platform')
    expect(url.searchParams.get('state')).toBeDefined()
    expect(prepared.state).toBe(url.searchParams.get('state'))
  })

  it('adds extra auth params', async () => {
    const prepared = await prepareAuth({ config: CONFIG, extraAuthParams: { prompt: 'consent' }, serverless: true })
    expect(new URL(prepared.url).searchParams.get('prompt')).toBe('consent')
  })

  it('adds code_challenge/code_challenge_method=S256 and exposes pkcePair when pkce:true', async () => {
    vi.stubGlobal('fetch', fakeFetch)
    const prepared = await prepareAuth({ config: CONFIG, serverless: true, pkce: true })
    const url = new URL(prepared.url)
    expect(url.searchParams.get('code_challenge')).toBe(prepared.pkcePair!.codeChallenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(prepared.pkcePair!.codeVerifier).toBeDefined()
    // no challenge on a non-pkce flow
    const plain = await prepareAuth({ config: CONFIG, serverless: true })
    expect(new URL(plain.url).searchParams.get('code_challenge')).toBeNull()
  })
})

describe('runAuthFlow', () => {
  it('opens browser, exchanges code, and returns a bundle + user', async () => {
    vi.stubGlobal('fetch', fakeFetch)
    let opened = ''
    const result = await runAuthFlow({
      config: CONFIG,
      openBrowser: async (url) => {
        opened = url
        // Simulate the redirect coming to the callback server.
        const redirect = new URL(url).searchParams.get('redirect_uri')!
        await fetch(`${redirect}?code=CODE&state=${new URL(url).searchParams.get('state')!}`)
      }
    })
    expect(opened).toContain('/o/oauth2/v2/auth')
    expect(result.user.email).toBe('a@b.com')
    expect(result.bundle.accessToken).toBe('at')
    expect(result.bundle.refreshToken).toBe('rt')
    expect(result.bundle.expiresAt).toBeGreaterThan(Date.now())
  })

  it('merges projectId from a previous bundle', async () => {
    vi.stubGlobal('fetch', fakeFetch)
    const result = await runAuthFlow({
      config: CONFIG,
      previousBundle: { accessToken: 'x', refreshToken: 'old', tokenType: 'Bearer', expiresAt: 0, projectId: 'proj-1' },
      openBrowser: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri')!
        await fetch(`${redirect}?code=CODE&state=${new URL(url).searchParams.get('state')!}`)
      }
    })
    expect(result.bundle.projectId).toBe('proj-1')
    expect(result.bundle.refreshToken).toBe('rt')
  })
})
