import { describe, it, expect } from 'vitest'
import { createAntigravityAdapter } from './adapter'
import { defineAdapterContractTests, type AdapterContractHost } from '@meow-gateway/provider-core'
import type { ProviderContext } from '@meow-gateway/provider-core'
import { OAuthTokenManager, type Fetcher, type OAuthTokenStore, type OAuthTokenBundle } from '@meow-gateway/oauth-core'
import { ANTIGRAVITY_OAUTH_CLIENT } from './metadata'

class MemoryTokenStore implements OAuthTokenStore {
  private readonly m = new Map<string, OAuthTokenBundle>()
  async get(ref: string): Promise<OAuthTokenBundle | null> { return this.m.get(ref) ?? null }
  async set(ref: string, b: OAuthTokenBundle): Promise<void> { this.m.set(ref, b) }
  async delete(ref: string): Promise<void> { this.m.delete(ref) }
}

const BASE_URL = 'https://mock.example.com'
const AUTH = 'at-123'

function ctx(overrides?: Partial<ProviderContext>): ProviderContext {
  return {
    credentialRef: 'provider.mocked',
    credential: JSON.stringify({ accessToken: AUTH, refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10, projectId: 'proj-1' }),
    baseUrl: BASE_URL,
    signal: new AbortController().signal,
    requestId: 'req-1',
    ...overrides
  }
}

function fetcherFor(handler: (url: string, init: Parameters<Fetcher>[1]) => Promise<{ ok: boolean; status: number; text: string }>): Fetcher {
  return async (url, init) => {
    const r = await handler(String(url), init)
    return {
      ok: r.ok,
      status: r.status,
      headers: { get: () => 'text/event-stream' },
      text: async () => r.text,
      json: async () => ({}),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(r.text)); c.close() } })
    } as never
  }
}

const streamingFetcher = fetcherFor(async (url) => {
  const u = String(url)
  if (u.includes('fetchAvailableModels')) return { ok: true, status: 200, text: JSON.stringify({ payload: { models: {} } }) }
  if (u.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'proj-1' } }) }
  if (u.includes('streamGenerateContent')) {
    return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":4}}}\n\ndata: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\ndata: [DONE]\n' }
  }
  return { ok: false, status: 404, text: '' }
})

async function collect(iter: AsyncIterable<unknown>): Promise<void> {
  for await (const item of iter) { void item; /* drain */ }
}

describe('AntigravityAdapter', () => {
  const host: AdapterContractHost = {
    buildAdapter: () => createAntigravityAdapter('antigravity', { fetcher: streamingFetcher }),
    startMock: async () => ({ baseUrl: BASE_URL, close: async () => {} }),
    makeContext: (baseUrl, overrides) => ctx({ baseUrl, ...overrides })
  }
  defineAdapterContractTests(host)

  it('resolves project id and reuses cached value from bundle on later calls', async () => {
    let loadCalls = 0
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('loadCodeAssist')) { loadCalls++; return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'proj-2' } }) } }
      if (url.includes('streamGenerateContent')) return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n[done]\n' }
      return { ok: true, status: 200, text: JSON.stringify({ payload: { models: {} } }) }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    await collect(adapter.chat(ctx({ credential: JSON.stringify({ accessToken: AUTH, refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10, projectId: 'proj-1' }) }), req))
    expect(loadCalls).toBe(0) // cached projectId in bundle -> no loadCodeAssist
  })

  it('maps a 401 to AUTH_ERROR', async () => {
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('streamGenerateContent')) return { ok: false, status: 401, text: 'unauthorized' }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    await expect(collect(adapter.chat(ctx(), req))).rejects.toMatchObject({ type: 'AUTH_ERROR' })
  })

  it('uses the tokenManager to obtain and refresh the access token (stale bundle path)', async () => {
    // Regression: the adapter must go through the OAuthTokenManager so an
    // expired access token is refreshed before talking to Antigravity. The
    // stale bundle has an expiresAt in the past; without refresh the adapter
    // would send the stale token and loadCodeAssist would 400 forever.
    const store = new MemoryTokenStore()
    const stale: OAuthTokenBundle = {
      accessToken: 'stale-at',
      refreshToken: 'rt-1',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 10_000 // expired
    }
    await store.set('provider:p', stale)

    const manager = new OAuthTokenManager({
      config: ANTIGRAVITY_OAUTH_CLIENT,
      store,
      client: {
        refreshAccessToken: async () => ({ accessToken: 'fresh-at', tokenType: 'Bearer', expiresInSec: 3600 })
      } as never
    })

    let lastAuth: string | undefined
    const fetcher: Fetcher = async (url, init) => {
      const u = String(url)
      if (u.includes('loadCodeAssist')) {
        const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
        lastAuth = auth
        if (auth === 'Bearer fresh-at') return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }), json: async () => ({ project: { id: 'p' } }) } as never
        return { ok: false, status: 400, text: 'bad' } as never
      }
      if (u.includes('streamGenerateContent')) {
        return {
          ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n',
          json: async () => ({}),
          body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n')); c.close() } })
        } as never
      }
      return { ok: false, status: 404, text: '' } as never
    }

    const adapter = createAntigravityAdapter('antigravity', { fetcher, tokenManager: manager })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    await collect(adapter.chat(ctx({ credentialRef: 'provider:p' }), req))

    expect(lastAuth).toBe('Bearer fresh-at')
    const stored = await store.get('provider:p')
    expect(stored?.accessToken).toBe('fresh-at')
  })
})
