import { describe, it, expect } from 'vitest'
import { createDeepSeekAdapter } from './adapter'
import { deepseekMetadata, DEEPSEEK_MODELS } from './metadata'
import type { Fetcher, FetcherResponse } from '@meow-gateway/provider-openai'
import type { ProviderContext } from '@meow-gateway/provider-core'
import { defineAdapterContractTests } from '@meow-gateway/provider-core'

const BASE_URL = 'https://api.deepseek.com/v1'
const ctx = (overrides?: Partial<ProviderContext>): ProviderContext => ({
  credentialRef: 'provider.deepseek.primary',
  credential: 'sk-ds-test',
  baseUrl: BASE_URL,
  signal: new AbortController().signal,
  requestId: 'req-ds',
  ...overrides
})

function jsonResponse(status: number, body: unknown): FetcherResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
    json: async () => body,
    body: null
  }
}

function sseResponse(status: number, blocks: string[]): FetcherResponse {
  const text = blocks.join('\n')
  const encoder = new TextEncoder()
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/event-stream' },
    text: async () => text,
    json: async () => ({}),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      }
    })
  }
}

describe('DeepSeekAdapter', () => {
  it('exposes deepseek metadata with correct id and base url', () => {
    expect(deepseekMetadata.id).toBe('deepseek')
    expect(deepseekMetadata.defaultBaseUrl).toContain('deepseek.com')
  })

  it('getModels merges static known models with dynamic ones', async () => {
    const fetcher: Fetcher = async (url) => {
      expect(url).toBe(`${BASE_URL}/models`)
      return jsonResponse(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-coder' }] })
    }
    const adapter = createDeepSeekAdapter('deepseek', fetcher)
    const models = await adapter.getModels(ctx())
    const ids = models.map((m) => m.id)
    expect(ids).toContain('deepseek-chat')
    expect(ids).toContain('deepseek-reasoner') // static base
    expect(ids).toContain('deepseek-coder') // dynamic
  })

  it('applies deepseek capabilities to known models', async () => {
    const fetcher: Fetcher = async () => jsonResponse(200, { data: [] })
    const adapter = createDeepSeekAdapter('deepseek', fetcher)
    const models = await adapter.getModels(ctx())
    const chat = models.find((m) => m.id === 'deepseek-chat')!
    expect(chat.capabilities.reasoning).toBe(true)
    expect(chat.capabilities.streaming).toBe(true)
  })

  it('streams chat completions through the openai-compatible base', async () => {
    const fetcher: Fetcher = async () =>
      sseResponse(200, [
        'data: {"id":"c","choices":[{"delta":{"content":"Deep"}}]}',
        'data: {"id":"c","choices":[{"delta":{"content":"seek"}}]}',
        'data: {"id":"c","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
        'data: [DONE]'
      ])
    const adapter = createDeepSeekAdapter('deepseek', fetcher)
    const chunks: string[] = []
    for await (const c of adapter.chat(ctx(), { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], stream: true })) {
      if (c.kind === 'content_delta' && c.delta) chunks.push(c.delta)
    }
    expect(chunks.join('')).toBe('Deepseek')
  })

  it('DEEPSEEK_MODELS are non-empty and well-formed', () => {
    expect(Array.isArray(DEEPSEEK_MODELS)).toBe(true)
    expect(DEEPSEEK_MODELS.length).toBeGreaterThan(0)
    for (const m of DEEPSEEK_MODELS) {
      expect(typeof m.id).toBe('string')
      expect(typeof m.displayName).toBe('string')
    }
  })
})

// The shared contract suite also must pass for DeepSeek, driven by a mock fetcher.
defineAdapterContractTests({
  buildAdapter: () => createDeepSeekAdapter('deepseek', mockFetcher()),
  startMock: async () => ({ baseUrl: BASE_URL, close: async () => {} }),
  makeContext: (baseUrl, overrides) => ctx({ baseUrl, ...overrides })
})

function mockFetcher(): Fetcher {
  return async (url, init) => {
    if (url.endsWith('/models')) {
      return jsonResponse(200, { data: [{ id: 'deepseek-chat' }] })
    }
    if (init?.headers?.Authorization === 'Bearer bad-key') {
      return jsonResponse(401, { error: { message: 'Invalid API key' } })
    }
    if (init?.body && init.body.includes('"stream":true')) {
      return sseResponse(200, [
        'data: {"id":"c","choices":[{"delta":{"content":"hi"}}]}',
        'data: {"id":"c","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
        'data: [DONE]'
      ])
    }
    return jsonResponse(200, {
      id: 'c',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    })
  }
}
