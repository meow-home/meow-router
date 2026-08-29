// Tests for the gateway server (T301), chat completions (T304) and streaming (T305).
// Fully offline: uses an in-memory fake adapter, never a real provider.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ProviderRegistry,
  ProviderError,
  type ProviderAdapter,
  type NormalizedChatRequest,
  type ModelInfo
} from '@meow-gateway/provider-core'
import { createGatewayServer, DEFAULT_HOST, type GatewayServer } from './server'
import type { GatewayDependencies, GatewayUsage, ResolvedModel, GatewayLogger } from './types'

function makeFakeAdapter(id: string, opts?: { fail?: boolean }): ProviderAdapter {
  return {
    id,
    async getModels() {
      return [
        {
          id,
          providerModelId: `${id}-model`,
          displayName: id,
          capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false }
        } satisfies ModelInfo
      ]
    },
    async validateCredentials() {
      return { ok: true, message: 'ok' }
    },
    async *chat(_ctx: unknown, _request: NormalizedChatRequest) {
      if (opts?.fail) {
        throw new ProviderError({ type: 'AUTH_ERROR', message: 'Provider rejected credentials', retryable: false })
      }
      const text = 'Hello from ' + id
      for (const word of text.split(' ')) {
        yield { id: 'chunk-1', kind: 'content_delta', delta: word + ' ' }
      }
      yield { id: 'chunk-1', kind: 'finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 3 } }
    }
  }
}

// Adapter that yields a chunk then waits for abort, recording when it is aborted.
function makeAbortAwareAdapter(id: string, onAbort: () => void): ProviderAdapter {
  return {
    id,
    async getModels() {
      return []
    },
    async validateCredentials() {
      return { ok: true, message: 'ok' }
    },
    async *chat(ctx: { signal: AbortSignal }, _request: NormalizedChatRequest) {
      yield { id: 'chunk-1', kind: 'content_delta', delta: 'partial ' }
      await new Promise<void>((resolve) => {
        if (ctx.signal.aborted) {
          onAbort()
          resolve()
          return
        }
        ctx.signal.addEventListener('abort', () => {
          onAbort()
          resolve()
        })
      })
    }
  }
}

async function resolveModelAsync(model: string): Promise<ResolvedModel | null> {
  if (model === 'gpt-4o' || model === 'deepseek-chat') {
    const providerId = model === 'gpt-4o' ? 'openai' : 'deepseek'
    return {
      providerId,
      providerModelId: model,
      model: {
        id: model,
        providerModelId: model,
        displayName: model,
        capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: true }
      }
    }
  }
  return null
}

function makeHarness(opts?: { adapter?: ProviderAdapter; credential?: string | null }) {
  const registry = new ProviderRegistry()
  const openai = opts?.adapter ?? makeFakeAdapter('openai')
  registry.register(openai)
  registry.register(makeFakeAdapter('deepseek'))

  const usages: GatewayUsage[] = []
  const logs: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = []
  const logger: GatewayLogger = {
    info: (msg, meta) => logs.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => logs.push({ level: 'error', msg, meta })
  }

  const deps: GatewayDependencies = {
    registry,
    getCredential: async () => (opts?.credential === undefined ? 'sk-test' : opts.credential),
    resolveModel: resolveModelAsync,
    recordUsage: async (u) => {
      usages.push(u)
    },
    listModels: async () => [
      { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
      { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' }
    ],
    logger
  }

  return { registry, usages, logs, deps }
}

async function startServer(deps: GatewayDependencies, port = 0): Promise<{ server: GatewayServer; addr: { host: string; port: number } }> {
  const server = createGatewayServer(deps, { port, host: DEFAULT_HOST })
  const addr = await server.start()
  return { server, addr }
}

interface GatewayJsonResponse {
  status: string
  gateway: { running: boolean }
  object: string
  error: { code: string; type: string; message: string }
  choices: Array<{ message: { content: string } }>
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: GatewayJsonResponse }> {
  const res = await fetch(url, init)
  const body = (await res.json()) as GatewayJsonResponse
  return { status: res.status, body }
}

describe('gateway server (T301)', () => {
  let harness: ReturnType<typeof makeHarness>
  let server: GatewayServer
  let addr: { host: string; port: number }

  beforeEach(async () => {
    harness = makeHarness()
    ;({ server, addr } = await startServer(harness.deps))
  })

  afterEach(async () => {
    await server.stop()
  })

  it('binds only to loopback', () => {
    expect(addr.host).toBe(DEFAULT_HOST)
  })

  it('listens on a non-zero port when given port 0', () => {
    expect(addr.port).toBeGreaterThan(0)
  })

  it('/health returns OK', async () => {
    const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/health`)
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.gateway.running).toBe(true)
  })

  it('shutdown closes active server resources', async () => {
    await server.stop()
    await expect(fetch(`http://${addr.host}:${addr.port}/health`)).rejects.toThrow()
  })

  it('occupied port produces a clear error', async () => {
    const blocker = createGatewayServer(harness.deps, { port: addr.port })
    await expect(blocker.start()).rejects.toThrow()
    await blocker.stop().catch(() => {})
  })
})

describe('chat completions (T304)', () => {
  it('valid request reaches selected provider and returns a completion', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(200)
      expect(body.object).toBe('chat.completion')
      expect(body.choices[0].message.content).toContain('Hello')
      expect(harness.usages).toHaveLength(1)
      expect(harness.usages[0].status).toBe('success')
      expect(harness.usages[0].virtualModelId).toBe('gpt-4o')
    } finally {
      await server.stop()
    }
  })

  it('unknown model returns MODEL_NOT_FOUND', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(404)
      expect(body.error.code).toBe('MODEL_NOT_FOUND')
    } finally {
      await server.stop()
    }
  })

  it('malformed request returns a client error', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) // missing model
      })
      expect(status).toBe(400)
      expect(body.error.code).toBe('INVALID_REQUEST')
    } finally {
      await server.stop()
    }
  })

  it('provider authentication failure is mapped to AUTH_ERROR', async () => {
    const harness = makeHarness({ adapter: makeFakeAdapter('openai', { fail: true }) })
    const { server, addr } = await startServer(harness.deps)
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(401)
      expect(body.error.code).toBe('PROVIDER_AUTH_FAILED')
    } finally {
      await server.stop()
    }
  })

  it('missing credential maps to AUTH_ERROR', async () => {
    const harness = makeHarness({ credential: null })
    const { server, addr } = await startServer(harness.deps)
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(401)
      expect(body.error.code).toBe('PROVIDER_AUTH_FAILED')
    } finally {
      await server.stop()
    }
  })

  it('includes request ID in internal logs', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      const requestLog = harness.logs.find((l) => l.msg === 'request')
      expect(requestLog).toBeTruthy()
      expect(requestLog!.meta!.requestId).toBeTruthy()
    } finally {
      await server.stop()
    }
  })
})

describe('streaming (T305)', () => {
  it('chunks arrive incrementally as SSE data frames', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const text = await res.text()
      const frames = text.split('\n').filter((l) => l.startsWith('data:'))
      expect(frames.length).toBeGreaterThanOrEqual(2)
      expect(frames[frames.length - 1].trim()).toBe('data: [DONE]')
      const contentFrame = frames.find((f) => f.includes('"content"'))
      expect(contentFrame).toBeTruthy()
      expect(contentFrame).toContain('Hello')
    } finally {
      await server.stop()
    }
  })

  it('stream closes cleanly with [DONE]', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      const text = await res.text()
      expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
    } finally {
      await server.stop()
    }
  })

  it('records usage after stream completion', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer(harness.deps)
    try {
      await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      expect(harness.usages).toHaveLength(1)
      expect(harness.usages[0].status).toBe('success')
      expect(harness.usages[0].inputTokens).toBe(5)
    } finally {
      await server.stop()
    }
  })

  it('stream error uses the documented error contract', async () => {
    const harness = makeHarness({ adapter: makeFakeAdapter('openai', { fail: true }) })
    const { server, addr } = await startServer(harness.deps)
    try {
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      const text = await res.text()
      // The stream contract expects a data frame carrying an error object.
      expect(text).toContain('"error"')
    } finally {
      await server.stop()
    }
  })

  it('aborts the provider request after client disconnect', async () => {
    let aborted = false
    const harness = makeHarness({
      adapter: makeAbortAwareAdapter('openai', () => {
        aborted = true
      })
    })
    const { server, addr } = await startServer(harness.deps)
    try {
      const controller = new AbortController()
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true }),
        signal: controller.signal
      })
      expect(res.status).toBe(200)
      // Break the connection to simulate a client disconnect.
      controller.abort()
      // Give the server a moment to observe the disconnect and abort upstream.
      await new Promise((r) => setTimeout(r, 150))
      expect(aborted).toBe(true)
      // No successful usage record for an aborted/partial stream.
      const success = harness.usages.filter((u) => u.status === 'success')
      expect(success).toHaveLength(0)
    } finally {
      await server.stop()
    }
  })

  it('partial streams do not create false successful usage records', async () => {
    const harness = makeHarness({ adapter: makeFakeAdapter('openai', { fail: true }) })
    const { server, addr } = await startServer(harness.deps)
    try {
      await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      const success = harness.usages.filter((u) => u.status === 'success')
      expect(success).toHaveLength(0)
    } finally {
      await server.stop()
    }
  })
})
