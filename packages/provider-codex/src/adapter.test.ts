import { describe, it, expect } from 'vitest'
import { createCodexAdapter } from './adapter'
import { defineAdapterContractTests, type AdapterContractHost } from '@meow-gateway/provider-core'
import type { ProviderContext } from '@meow-gateway/provider-core'
import { OAuthTokenManager, type Fetcher, type OAuthTokenStore, type OAuthTokenBundle } from '@meow-gateway/oauth-core'
import { CODEX_OAUTH_CLIENT } from './metadata'

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
    credential: AUTH,
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
      json: async () => {
        try { return JSON.parse(r.text) } catch { return {} }
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(r.text))
          controller.close()
        }
      })
    } as any
  }
}

const RESPONSES_SSE =
  'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
  'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":4}}}\n\n' +
  'data: [DONE]\n'

const streamingFetcher = fetcherFor(async (url, init) => {
  const u = String(url)
  const auth = init?.headers?.['Authorization'] ?? ''
  if (auth === 'Bearer bad-key') return { ok: false, status: 401, text: 'unauthorized' }
  if (u.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [{ id: 'gpt-5', object: 'model' }] }) }
  if (u.includes('/responses')) {
    // Non-streaming requests expect a JSON body; streaming expects SSE.
    const body = init?.body ? JSON.parse(init.body) : {}
    if (body.stream === false) {
      return { ok: true, status: 200, text: JSON.stringify({ output: 'Hi', usage: { input_tokens: 3, output_tokens: 4 } }) }
    }
    return { ok: true, status: 200, text: RESPONSES_SSE }
  }
  return { ok: false, status: 404, text: '' }
})

describe('CodexAdapter', () => {
  const host: AdapterContractHost = {
    buildAdapter: () => createCodexAdapter('codex', { fetcher: streamingFetcher }),
    startMock: async () => ({ baseUrl: BASE_URL, close: async () => {} }),
    makeContext: (baseUrl, overrides) => ctx({ baseUrl, ...overrides })
  }
  defineAdapterContractTests(host)

  it('sets Bearer + originator headers and forwards to /responses', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    const fetcher = fetcherFor(async (url, init) => {
      seenUrl = String(url)
      seenHeaders = init?.headers ?? {}
      if (url.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [] }) }
      return { ok: true, status: 200, text: 'data: {"type":"response.completed"}\n\ndata: [DONE]\n' }
    })
    const adapter = createCodexAdapter('codex', { fetcher })
    const req = { model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    for await (const _c of adapter.chat(ctx(), req)) { void _c.delta }
    expect(seenUrl).toContain('/responses')
    expect(seenHeaders['Authorization']).toBe(`Bearer ${AUTH}`)
    expect(seenHeaders['originator']).toBe('Codex Desktop')
  })

  it('falls back to chat/completions when /responses 404s', async () => {
    const hits: string[] = []
    const fetcher = fetcherFor(async (url) => {
      hits.push(String(url))
      if (url.includes('/responses')) return { ok: false, status: 404, text: 'no such model' }
      if (url.includes('/chat/completions')) return { ok: true, status: 200, text: 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n' }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createCodexAdapter('codex', { fetcher })
    const req = { model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    const chunks = []
    for await (const chunk of adapter.chat(ctx(), req)) chunks.push(chunk)
    expect(hits.some((h) => h.includes('/responses'))).toBe(true)
    expect(hits.some((h) => h.includes('/chat/completions'))).toBe(true)
    expect(chunks.some((c) => c.kind === 'content_delta')).toBe(true)
  })

  it('maps a 401 to AUTH_ERROR', async () => {
    const fetcher = fetcherFor(async () => ({ ok: false, status: 401, text: 'unauthorized' }))
    const adapter = createCodexAdapter('codex', { fetcher })
    const req = { model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    await expect(async () => { for await (const _ of adapter.chat(ctx(), req)) { void _.delta } }).rejects.toMatchObject({ type: 'AUTH_ERROR' })
  })

  it('resolves auth via an injected tokenManager (fresh token) and sets Bearer', async () => {
    const store = new MemoryTokenStore()
    await store.set('provider.mocked', { accessToken: 'fresh-token', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 })
    const manager = new OAuthTokenManager({ config: CODEX_OAUTH_CLIENT, store })
    let seenAuth = ''
    const fetcher = fetcherFor(async (url, init) => {
      seenAuth = init?.headers?.['Authorization'] ?? ''
      if (url.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [] }) }
      return { ok: true, status: 200, text: 'data: {"type":"response.output_text.delta","delta":"x"}\n\ndata: [DONE]\n' }
    })
    const adapter = createCodexAdapter('codex', { fetcher, tokenManager: manager })
    await adapter.validateCredentials(ctx({ credential: undefined }))
    expect(seenAuth).toBe('Bearer fresh-token')
  })
})
