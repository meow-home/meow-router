import { describe, it, expect } from 'vitest'
import { createOpenAICompatibleAdapter } from './openaiAdapter'
import type { Fetcher, FetcherResponse } from './http'
import type { ProviderContext, NormalizedChatChunk } from '@meow-gateway/provider-core'
import { defineAdapterContractTests, accumulateText, ProviderError } from '@meow-gateway/provider-core'

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

const BASE_URL = 'https://mock.example/v1'
const ctx = (overrides?: Partial<ProviderContext>): ProviderContext => ({
  credentialRef: 'provider.openai.primary',
  credential: 'sk-test-123',
  baseUrl: BASE_URL,
  signal: new AbortController().signal,
  requestId: 'req-1',
  ...overrides
})

describe('OpenAICompatibleAdapter', () => {
  it('rejects unsafe (loopback/private) base URL as SSRF', async () => {
    const fetcher: Fetcher = async () => jsonResponse(200, { data: [] })
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    await expect(adapter.getModels(ctx({ baseUrl: 'http://127.0.0.1:8080/v1' }))).rejects.toThrow(ProviderError)
    await expect(adapter.getModels(ctx({ baseUrl: 'http://localhost/v1' }))).rejects.toThrow(/Unsafe provider endpoint/)
  })

  it('getModels returns normalized ModelInfo[]', async () => {
    const fetcher: Fetcher = async (url) => {
      expect(url).toBe(`${BASE_URL}/models`)
      return jsonResponse(200, { data: [{ id: 'gpt-4o', object: 'model' }, { id: 'gpt-4o-mini' }] })
    }
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    const models = await adapter.getModels(ctx())
    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('gpt-4o')
    expect(models[0].capabilities.streaming).toBe(true)
  })

  it('validates credentials with a GET /models (no prompt sent)', async () => {
    let sawAuthHeader = ''
    const fetcher: Fetcher = async (url, init) => {
      expect(url).toBe(`${BASE_URL}/models`)
      sawAuthHeader = init?.headers?.Authorization ?? ''
      return jsonResponse(200, { data: [{ id: 'gpt-4o' }] })
    }
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    const result = await adapter.validateCredentials(ctx())
    expect(result.ok).toBe(true)
    expect(sawAuthHeader).toBe('Bearer sk-test-123')
  })

  it('normalizes auth failure to AUTH_ERROR', async () => {
    const fetcher: Fetcher = async () =>
      jsonResponse(401, { error: { message: 'Invalid API key', code: 'invalid_api_key' } })
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    await expect(adapter.validateCredentials(ctx())).resolves.toEqual({ ok: false, message: 'Invalid API key' })
  })

  it('normalizes rate limit to RATE_LIMIT', async () => {
    const fetcher: Fetcher = async () =>
      jsonResponse(429, { error: { message: 'Rate limited', code: 'rate_limit' } })
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    try {
      for await (const chunk of adapter.chat(ctx(), { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
        void chunk
      }
      throw new Error('expected throw')
    } catch (err) {
      expect((err as { type: string }).type).toBe('RATE_LIMIT')
    }
  })

  it('forwards assistant tool_calls in the request body', async () => {
    // A tool-use conversation re-sends the assistant tool-call request; the
    // body must keep tool_calls or the upstream rejects the assistant message.
    let sentBody: { messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }> }
    const fetcher: Fetcher = async (_url, init) => {
      sentBody = JSON.parse(init?.body ?? '{}')
      return jsonResponse(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    }
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    const toolCalls = [{ id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{}' } }]
    const chunks: NormalizedChatChunk[] = []
    for await (const c of adapter.chat(ctx(), {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: null, toolCalls },
        { role: 'tool', content: 'sunny', toolCallId: 'call_abc' }
      ]
    })) {
      chunks.push(c)
    }
    expect(sentBody!.messages![1].role).toBe('assistant')
    expect(sentBody!.messages![1].tool_calls).toEqual(toolCalls)
    expect(sentBody!.messages![2].tool_call_id).toBe('call_abc')
  })

  it('non-streaming returns full content then finish', async () => {
    const fetcher: Fetcher = async () =>
      jsonResponse(200, {
        id: 'chatcmpl-1',
        choices: [{ message: { content: 'Hello there' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    const chunks: NormalizedChatChunk[] = []
    for await (const c of adapter.chat(ctx(), { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(c)
    }
    // Simulate an async iterable that yields all chunks at once.
    const text = await accumulateText((async function* () { yield* chunks })())
    expect(text).toBe('Hello there')
    const finish = chunks[chunks.length - 1]
    expect(finish.kind).toBe('finish')
    expect(finish.finishReason).toBe('stop')
    expect(finish.usage?.inputTokens).toBe(10)
  })

  it('streaming emits content deltas then finish with usage', async () => {
    const fetcher: Fetcher = async () =>
      sseResponse(200, [
        'data: {"id":"chatcmpl-2","choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"id":"chatcmpl-2","choices":[{"delta":{"content":"lo"}}]}',
        'data: {"id":"chatcmpl-2","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
        'data: [DONE]'
      ])
    const adapter = createOpenAICompatibleAdapter('openai', fetcher)
    const chunks: NormalizedChatChunk[] = []
    for await (const c of adapter.chat(ctx(), { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })) {
      chunks.push(c)
    }
    const text = await accumulateText((async function* () { yield* chunks })())
    expect(text).toBe('Hello')
    const finish = chunks.find((c) => c.kind === 'finish')
    expect(finish).toBeDefined()
    expect(finish!.finishReason).toBe('stop')
    expect(finish!.usage?.outputTokens).toBe(2)
  })
})

// Run the shared contract suite against the OpenAI-compatible adapter, driven by
// a deterministic in-memory mock fetcher (fully offline).
defineAdapterContractTests({
  buildAdapter: () => createOpenAICompatibleAdapter('openai', mockFetcher()),
  startMock: async () => ({ baseUrl: BASE_URL, close: async () => {} }),
  makeContext: (baseUrl, overrides) => ctx({ baseUrl, ...overrides })
})

function mockFetcher(): Fetcher {
  return async (url, init) => {
    if (url.endsWith('/models')) {
      return jsonResponse(200, { data: [{ id: 'gpt-4o' }] })
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
