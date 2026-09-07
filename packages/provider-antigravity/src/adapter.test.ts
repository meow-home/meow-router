import { describe, it, expect } from 'vitest'
import { createAntigravityAdapter } from './adapter'
import { defineAdapterContractTests, type AdapterContractHost } from '@meow-gateway/provider-core'
import type { ProviderContext } from '@meow-gateway/provider-core'
import type { Fetcher } from '@meow-gateway/oauth-core'

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
})
