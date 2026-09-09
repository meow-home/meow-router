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

  it('maps OpenAI-style roles to Gemini contents (system/assistant/tool) so the API does not reject with INVALID_ARGUMENT', async () => {
    // Regression: the Cloud Code Assist API only accepts `user`/`model` roles in
    // contents. Sending `system`/`assistant`/`tool` verbatim yields 400
    // INVALID_ARGUMENT. `system` must go to systemInstruction, `assistant` to
    // `model`, and `tool` results to a `user` functionResponse.
    let sentBody: string | undefined
    const fetcher = fetcherFor(async (url, init) => {
      if (url.includes('streamGenerateContent')) {
        sentBody = init?.body as string
        return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}}]}}]}\n\n' }
      }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = {
      model: 'm',
      messages: [
        { role: 'system' as const, content: 'be helpful' },
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'hello', toolCalls: [{ id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] },
        { role: 'tool' as const, content: 'sunny', toolCallId: 'call_1' }
      ],
      stream: true
    }
    await collect(adapter.chat(ctx(), req))

    const body = JSON.parse(sentBody!) as {
      request: { contents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }>; systemInstruction?: { parts: Array<{ text: string }> } }
    }
    const contents = body.request.contents
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(contents[0].parts[0].text).toBe('hi')
    expect(contents[1].parts[0].text).toBe('hello')
    expect(contents[1].parts[1].functionCall).toEqual({ name: 'get_weather', args: { city: 'SF' } })
    expect(contents[2].parts[0].functionResponse).toEqual({ name: 'get_weather', response: { result: 'sunny' } })
    // system prompt merged into systemInstruction
    expect(body.request.systemInstruction?.parts[0].text).toBe('be helpful')
  })

  it('translates OpenAI tools and tool_choice into Gemini functionDeclarations so the model can call tools', async () => {
    // Regression: the adapter never forwarded `request.tools`, so the model was
    // never told about the available tools and never emitted a functionCall.
    let sentBody: string | undefined
    const fetcher = fetcherFor(async (url, init) => {
      if (url.includes('streamGenerateContent')) {
        sentBody = init?.body as string
        return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n' }
      }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = {
      model: 'm',
      messages: [{ role: 'user' as const, content: 'what is the weather in SF?' }],
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
      toolChoice: { type: 'function', function: { name: 'get_weather' } },
      stream: true
    }
    await collect(adapter.chat(ctx(), req))

    const body = JSON.parse(sentBody!) as {
      request: { tools?: Array<{ functionDeclarations: Array<{ name: string; description?: string; parameters?: unknown }> }>; toolConfig?: { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } } }
    }
    expect(body.request.tools).toEqual([
      { functionDeclarations: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }] }
    ])
    expect(body.request.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] } })
  })

  it('strips JSON Schema keywords Gemini does not support from tool parameters', async () => {
    // Regression: clients send full JSON Schema in `parameters` (e.g. `$schema`,
    // `exclusiveMinimum`, `additionalProperties`). The Cloud Code Assist API
    // rejects those with 400 INVALID_ARGUMENT ("Unknown name ... Cannot find
    // field"). The adapter must keep only the keywords Gemini's Schema accepts.
    let sentBody: string | undefined
    const fetcher = fetcherFor(async (url, init) => {
      if (url.includes('streamGenerateContent')) {
        sentBody = init?.body as string
        return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n' }
      }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = {
      model: 'm',
      messages: [{ role: 'user' as const, content: 'hi' }],
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            additionalProperties: false,
            properties: {
              city: { type: 'string', minLength: 1 },
              temp: { type: 'number', exclusiveMinimum: 0, minimum: 0 }
            },
            required: ['city']
          }
        }
      }],
      stream: true
    }
    await collect(adapter.chat(ctx(), req))

    const body = JSON.parse(sentBody!) as {
      request: { tools?: Array<{ functionDeclarations: Array<{ parameters: Record<string, unknown> }> }> }
    }
    const params = body.request.tools![0].functionDeclarations[0].parameters
    expect(params).toEqual({
      type: 'object',
      properties: {
        city: { type: 'string', minLength: 1 },
        temp: { type: 'number', minimum: 0 }
      },
      required: ['city']
    })
    // Unsupported keywords must be gone.
    expect('$schema' in params).toBe(false)
    expect('additionalProperties' in params).toBe(false)
    const temp = (params.properties as Record<string, Record<string, unknown>>).temp
    expect('exclusiveMinimum' in temp).toBe(false)
  })

  it('streams every content block and only emits finish on a real finishReason (CRLF-safe)', async () => {
    // Regression: the adapter used to emit a `finish` chunk after EVERY SSE
    // block (because each block carries usageMetadata). The gateway stops on the
    // first `finish`, so only the first token streamed. It also split on '\n\n'
    // while the provider emits '\r\n\r\n', buffering the whole response.
    const sse = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}}',
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}}',
      'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}',
      'data: [DONE]'
    ].join('\r\n\r\n') + '\r\n\r\n'
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('streamGenerateContent')) return { ok: true, status: 200, text: sse }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    const chunks: Array<{ kind: string; delta?: string; finishReason?: string }> = []
    for await (const c of adapter.chat(ctx(), req)) chunks.push(c as never)

    const deltas = chunks.filter((c) => c.kind === 'content_delta').map((c) => c.delta)
    expect(deltas).toEqual(['Hello', ' world'])
    const finishes = chunks.filter((c) => c.kind === 'finish')
    expect(finishes).toHaveLength(1)
    expect(finishes[0].finishReason).toBe('stop')
  })

  it('emits a tool_call_delta when the model returns a functionCall part instead of text', async () => {
    // Regression: the model can respond with a function call (tool call) rather
    // than text. The adapter used to drop functionCall parts entirely, so the
    // client received an empty completion that immediately finished.
    const sse = [
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thoughtSignature":"sig","functionCall":{"name":"get_weather","args":{"city":"SF"}}}]}}]}}',
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}]}}',
      'data: [DONE]'
    ].join('\n\n') + '\n\n'
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('streamGenerateContent')) return { ok: true, status: 200, text: sse }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    const chunks: Array<{ kind: string; delta?: string; toolCall?: { name?: string; arguments?: string }; finishReason?: string }> = []
    for await (const c of adapter.chat(ctx(), req)) chunks.push(c as never)

    const toolCalls = chunks.filter((c) => c.kind === 'tool_call_delta')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].toolCall?.name).toBe('get_weather')
    expect(toolCalls[0].toolCall?.arguments).toBe('{"city":"SF"}')
    // Text still streams alongside the tool call.
    expect(chunks.some((c) => c.kind === 'content_delta' && c.delta === 'ok')).toBe(true)
    const finishes = chunks.filter((c) => c.kind === 'finish')
    expect(finishes).toHaveLength(1)
    expect(finishes[0].finishReason).toBe('stop')
  })

  it('round-trips the Gemini thoughtSignature through the tool-call id so a resent functionCall is not rejected', async () => {
    // Regression: the Cloud Code Assist API requires a `functionCall` part to
    // carry its `thoughtSignature` when it is resent in a multi-turn history.
    // The adapter used to drop the signature, so the second turn (assistant
    // tool_calls + tool result) was rejected with 400 INVALID_ARGUMENT
    // ("Function call is missing a thought_signature in functionCall parts").
    // The signature is stashed in the tool-call id the adapter emits, then
    // recovered when the client echoes that id back.
    const sse = [
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thoughtSignature":"sig-abc","functionCall":{"name":"get_weather","args":{"city":"SF"}}}]}}]}}',
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}]}}',
      'data: [DONE]'
    ].join('\n\n') + '\n\n'
    let sentBody: string | undefined
    const fetcher = fetcherFor(async (url, init) => {
      if (url.includes('streamGenerateContent')) {
        sentBody = init?.body as string
        return { ok: true, status: 200, text: sse }
      }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })

    // Turn 1: model returns a functionCall with a thoughtSignature.
    const chunks: Array<{ kind: string; toolCall?: { id?: string; name?: string; arguments?: string } }> = []
    for await (const c of adapter.chat(ctx(), { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true })) chunks.push(c as never)
    const emitted = chunks.find((c) => c.kind === 'tool_call_delta')?.toolCall
    expect(emitted?.name).toBe('get_weather')
    expect(emitted?.id).toMatch(/^call_0_ts_/)

    // Turn 2: client echoes the assistant tool_call (with the id we emitted)
    // plus the tool result. The reconstructed functionCall must carry the
    // thoughtSignature.
    const req = {
      model: 'm',
      messages: [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: null, toolCalls: [{ id: emitted!.id, function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] },
        { role: 'tool' as const, content: 'sunny', toolCallId: emitted!.id }
      ],
      stream: true
    }
    await collect(adapter.chat(ctx(), req))
    const body = JSON.parse(sentBody!) as {
      request: { contents: Array<{ role: string; parts: Array<{ thoughtSignature?: string; functionCall?: unknown; functionResponse?: unknown }> }> }
    }
    const modelPart = body.request.contents.find((c) => c.role === 'model')!.parts.find((p) => p.functionCall)!
    expect(modelPart.thoughtSignature).toBe('sig-abc')
    expect(modelPart.functionCall).toEqual({ name: 'get_weather', args: { city: 'SF' } })
  })

  it('falls back to the next base URL when the primary endpoint returns a retryable 5xx', async () => {
    // Regression: the streaming request only tried the single configured base
    // URL. When it intermittently 5xx'd, the user saw a spurious
    // PROVIDER_UNAVAILABLE even though a sibling endpoint was healthy.
    const calls: string[] = []
    const fetcher = fetcherFor(async (url) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      if (u.includes('streamGenerateContent')) {
        if (u.includes('daily-cloudcode-pa.googleapis.com')) return { ok: false, status: 500, text: 'boom' }
        return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n' }
      }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    const chunks: Array<{ kind: string; delta?: string; finishReason?: string }> = []
    for await (const c of adapter.chat(ctx({ baseUrl: 'https://daily-cloudcode-pa.googleapis.com' }), req)) chunks.push(c as never)
    expect(chunks.some((c) => c.kind === 'content_delta' && c.delta === 'ok')).toBe(true)
    // The primary (daily) endpoint was tried and failed, then the fallback succeeded.
    expect(calls.some((u) => u.includes('daily-cloudcode-pa.googleapis.com') && u.includes('streamGenerateContent'))).toBe(true)
    expect(calls.some((u) => u.includes('cloudcode-pa.googleapis.com') && u.includes('streamGenerateContent'))).toBe(true)
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

  it('surfaces reasoning (thought) parts as reasoning_delta instead of dropping them', async () => {
    // Regression: gemini-2.5-flash streams its chain-of-thought in parts with
    // thought: true. The adapter used to skip them, so a reasoning-only turn
    // produced an empty stream that finished immediately ("loading then done").
    const sse = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Let me think"}]}}]}}',
      'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":" step by step"}]}}]}}',
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Final answer"}]},"finishReason":"STOP"}]}}',
      'data: [DONE]'
    ].join('\n\n') + '\n\n'
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('streamGenerateContent')) return { ok: true, status: 200, text: sse }
      if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    const chunks: Array<{ kind: string; delta?: string; finishReason?: string }> = []
    for await (const c of adapter.chat(ctx(), req)) chunks.push(c as never)

    const reasoning = chunks.filter((c) => c.kind === 'reasoning_delta').map((c) => c.delta).join('')
    expect(reasoning).toBe('Let me think step by step')
    // Text still streams as content_delta.
    expect(chunks.some((c) => c.kind === 'content_delta' && c.delta === 'Final answer')).toBe(true)
    const finishes = chunks.filter((c) => c.kind === 'finish')
    expect(finishes).toHaveLength(1)
    expect(finishes[0].finishReason).toBe('stop')
  })
})
