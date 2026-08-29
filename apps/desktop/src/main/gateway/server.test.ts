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
import { openDatabase, closeDatabase, type PersistedConnection } from '../database/connection'
import { ProviderRepository, ModelRepository, VirtualModelRepository, UsageRepository } from '../database/repositories'
import { VirtualModelService } from './virtualModelService'
import { UsageService } from './usageService'

function makeFakeAdapter(id: string, opts?: { fail?: boolean; retryableFail?: boolean }): ProviderAdapter {
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
      if (opts?.retryableFail) {
        throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Provider temporarily down', retryable: true })
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
  data?: Array<{ id: string }>
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
  it('reports stopped status and can be restarted', async () => {
    await server.stop()
    expect(server.listener()).toBeUndefined()
    const restarted = await server.start()
    expect(server.listener()).toBeDefined()
    expect(restarted.port).toBeGreaterThan(0)
    await server.stop()
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

describe('virtual model integration (T401)', () => {
  let db: PersistedConnection
  let vmRepo: VirtualModelRepository
  let service: VirtualModelService

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    const providerRepo = new ProviderRepository(db)
    const modelRepo = new ModelRepository(db)
    vmRepo = new VirtualModelRepository(db)
    providerRepo.create({ id: 'deepseek', type: 'deepseek', display_name: 'DeepSeek' })
    providerRepo.create({ id: 'openai', type: 'openai', display_name: 'OpenAI' })
    modelRepo.create({ provider_id: 'openai', provider_model_id: 'gpt-4o', display_name: 'GPT-4o' })
    modelRepo.create({ provider_id: 'deepseek', provider_model_id: 'deepseek-chat', display_name: 'D' })
    service = new VirtualModelService(vmRepo)
  })

  afterEach(() => closeDatabase(db))

  async function start(): Promise<{ server: GatewayServer; addr: { host: string; port: number } }> {
    const registry = new ProviderRegistry()
    registry.register(makeFakeAdapter('openai'))
    registry.register(makeFakeAdapter('deepseek'))
    const deps: GatewayDependencies = {
      registry,
      getCredential: async () => 'sk-test',
      resolveModel: (id) => service.resolveModel(id),
      listModels: () => service.listModels(),
      recordUsage: async () => {}
    }
    const server = createGatewayServer(deps, { host: DEFAULT_HOST, port: 0 })
    const addr = await server.start()
    return { server, addr }
  }

  it('/v1/models lists enabled virtual models', async () => {
    vmRepo.create({ display_name: 'meow-coding', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    vmRepo.create({ display_name: 'off', provider_id: 'openai', provider_model_id: 'gpt-4o', enabled: false })
    const { server, addr } = await start()
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/models`)
      expect(status).toBe(200)
      expect(body.object).toBe('list')
      expect(body.choices).toBeUndefined() // no choices field on model list
      const ids = (body.data as { id: string }[] | undefined)?.map((m) => m.id) ?? []
      expect(ids).toContain('meow-coding')
      expect(ids).not.toContain('off')
    } finally {
      await server.stop()
    }
  })

  it('chat resolves the virtual model to the mapped provider', async () => {
    vmRepo.create({ display_name: 'meow-coding', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    const { server, addr } = await start()
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meow-coding', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(200)
      expect(body.object).toBe('chat.completion')
      expect(body.choices[0].message.content).toContain('Hello from deepseek')
    } finally {
      await server.stop()
    }
  })

  it('unknown virtual model returns MODEL_NOT_FOUND', async () => {
    const { server, addr } = await start()
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
})

describe('usage recording integration (T501)', () => {
  let db: PersistedConnection
  let usageRepo: UsageRepository

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    const providerRepo = new ProviderRepository(db)
    const modelRepo = new ModelRepository(db)
    usageRepo = new UsageRepository(db)
    providerRepo.create({ id: 'openai', type: 'openai', display_name: 'OpenAI' })
    modelRepo.create({ provider_id: 'openai', provider_model_id: 'gpt-4o', display_name: 'GPT-4o', input_price: 2, output_price: 8 })
  })

  afterEach(() => closeDatabase(db))

  async function start(): Promise<{ server: GatewayServer; addr: { host: string; port: number } }> {
    const registry = new ProviderRegistry()
    registry.register(makeFakeAdapter('openai'))
    const usage = new UsageService(usageRepo, new ModelRepository(db))
    const deps: GatewayDependencies = {
      registry,
      getCredential: async () => 'sk-test',
      resolveModel: async (id) =>
        id === 'gpt-4o'
          ? {
              providerId: 'openai',
              providerModelId: 'gpt-4o',
              model: {
                id: 'gpt-4o',
                providerModelId: 'gpt-4o',
                displayName: 'GPT-4o',
                capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: true }
              }
            }
          : null,
      listModels: async () => [],
      recordUsage: (u) => usage.recordUsage(u)
    }
    const server = createGatewayServer(deps, { host: DEFAULT_HOST, port: 0 })
    const addr = await server.start()
    return { server, addr }
  }

  it('records a usage row for a successful request with cost', async () => {
    const { server, addr } = await start()
    try {
      await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      const rows = usageRepo.list()
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('success')
      expect(rows[0].input_tokens).toBe(5)
      expect(rows[0].estimated_cost).not.toBeNull()
    } finally {
      await server.stop()
    }
  })

  it('records an error status for a failed request', async () => {
    const registry = new ProviderRegistry()
    registry.register(makeFakeAdapter('openai', { fail: true }))
    const usage = new UsageService(usageRepo, new ModelRepository(db))
    const deps: GatewayDependencies = {
      registry,
      getCredential: async () => 'sk-test',
      resolveModel: async (id) =>
        id === 'gpt-4o'
          ? {
              providerId: 'openai',
              providerModelId: 'gpt-4o',
              model: {
                id: 'gpt-4o',
                providerModelId: 'gpt-4o',
                displayName: 'GPT-4o',
                capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: true }
              }
            }
          : null,
      listModels: async () => [],
      recordUsage: (u) => usage.recordUsage(u)
    }
    const server = createGatewayServer(deps, { host: DEFAULT_HOST, port: 0 })
    const addr = await server.start()
    try {
      await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      const rows = usageRepo.list()
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('error')
      expect(rows[0].error_code).toBe('AUTH_ERROR')
    } finally {
      await server.stop()
    }
  })
})

describe('routing & fallback (T701)', () => {
  // Build a deps with an ordered route list and per-attempt usage capture.
  function makeRoutingDeps(opts: {
    primary?: { fail?: boolean; retryableFail?: boolean }
    fallback?: { fail?: boolean; retryableFail?: boolean }
    routes?: Array<{ providerId: string; providerModelId: string }>
  }) {
    const registry = new ProviderRegistry()
    const primary = opts.primary ?? {}
    const fallback = opts.fallback ?? {}
    registry.register(makeFakeAdapter('openai', primary))
    registry.register(makeFakeAdapter('deepseek', fallback))

    const usages: GatewayUsage[] = []
    const routes =
      opts.routes ?? [
        { providerId: 'openai', providerModelId: 'gpt-4o' },
        { providerId: 'deepseek', providerModelId: 'deepseek-chat' }
      ]

    const deps: GatewayDependencies = {
      registry,
      getCredential: async () => 'sk-test',
      resolveModel: async (id) =>
        id === 'meow-coding'
          ? {
              providerId: 'openai',
              providerModelId: 'gpt-4o',
              model: {
                id: 'gpt-4o',
                providerModelId: 'gpt-4o',
                displayName: 'GPT-4o',
                capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: true }
              }
            }
          : null,
      resolveRoutes: async (id) => (id === 'meow-coding' ? { routes, usedFallback: routes.length > 1 } : { routes: [], usedFallback: false }),
      listModels: async () => [],
      recordUsage: async (u) => {
        usages.push(u)
      }
    }
    return { registry, usages, deps }
  }

  async function withServer(deps: GatewayDependencies, fn: (addr: { host: string; port: number }) => Promise<void>) {
    const server = createGatewayServer(deps, { host: DEFAULT_HOST, port: 0 })
    const addr = await server.start()
    try {
      await fn(addr)
    } finally {
      await server.stop()
    }
  }

  it('primary provider is attempted first and succeeds', async () => {
    const { usages, deps } = makeRoutingDeps({})
    await withServer(deps, async (addr) => {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meow-coding', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(200)
      expect(body.choices[0].message.content).toContain('openai')
      // Only the primary route attempted.
      expect(usages).toHaveLength(1)
      expect(usages[0].providerId).toBe('openai')
      expect(usages[0].routeAttempt).toBe(0)
    })
  })

  it('falls back to the next route on a retryable failure', async () => {
    const { usages, deps } = makeRoutingDeps({ primary: { retryableFail: true } })
    await withServer(deps, async (addr) => {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meow-coding', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(200)
      expect(body.choices[0].message.content).toContain('deepseek')
      // Two attempts recorded; fallback is observable via routeAttempt=1.
      expect(usages).toHaveLength(2)
      expect(usages[0].providerId).toBe('openai')
      expect(usages[0].status).toBe('error')
      expect(usages[0].routeAttempt).toBe(0)
      expect(usages[1].providerId).toBe('deepseek')
      expect(usages[1].status).toBe('success')
      expect(usages[1].routeAttempt).toBe(1)
    })
  })

  it('does NOT fall back on a non-retryable failure', async () => {
    const { usages, deps } = makeRoutingDeps({ primary: { fail: true } })
    await withServer(deps, async (addr) => {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meow-coding', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(401)
      // Only the primary attempted; no fallback.
      expect(usages).toHaveLength(1)
      expect(usages[0].providerId).toBe('openai')
      expect(usages[0].status).toBe('error')
      expect(usages[0].errorCode).toBe('AUTH_ERROR')
    })
  })

  it('all routes failing returns an error and records each attempt', async () => {
    const { usages, deps } = makeRoutingDeps({ primary: { retryableFail: true }, fallback: { retryableFail: true } })
    await withServer(deps, async (addr) => {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meow-coding', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(503)
      expect(usages).toHaveLength(2)
      expect(usages[0].status).toBe('error')
      expect(usages[1].status).toBe('error')
    })
  })

  it('non-retryable provider rejection aborts immediately even with a fallback available', async () => {
    const { usages, deps } = makeRoutingDeps({ primary: { fail: true }, fallback: {} })
    await withServer(deps, async (addr) => {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meow-coding', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(401)
      expect(usages).toHaveLength(1)
      expect(usages[0].providerId).toBe('openai')
    })
  })
})

describe('gateway auth', () => {
  const KEY = 'mgw_0123456789abcdef0123456789ab1f4a'

  it('rejects a chat completion with no key when auth is on', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(401)
      expect(JSON.stringify(body)).not.toContain(KEY)
    } finally {
      await server.stop()
    }
  })

  it('accepts a chat completion with the correct key', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('serves /health without a key while auth is on', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/health`)
      expect(status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('rejects GET /v1/models without a key', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/models`)
      expect(status).toBe(401)
    } finally {
      await server.stop()
    }
  })

  it('streams a completion with the correct key', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const frames = (await res.text()).split('\n').filter((l) => l.startsWith('data:'))
      expect(frames[frames.length - 1].trim()).toBe('data: [DONE]')
    } finally {
      await server.stop()
    }
  })

  it('never logs the Authorization header', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      await fetchJson(`http://${addr.host}:${addr.port}/v1/models`, {
        headers: { authorization: `Bearer ${KEY}` }
      })
      expect(JSON.stringify(harness.logs)).not.toContain(KEY)
    } finally {
      await server.stop()
    }
  })
})

describe('provider credential resolution', () => {
  it('asks for the credential ref that ProviderService actually writes', async () => {
    // ProviderService stores secrets under `provider:<id>` (providerService.ts).
    // A gateway that invents a different ref finds nothing and reports the
    // provider as unconfigured on every single chat request.
    const asked: string[] = []
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getCredential: async (ref: string) => {
        asked.push(ref)
        return ref === 'provider:openai' ? 'sk-test' : null
      }
    })
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(asked).toContain('provider:openai')
      expect(body.error?.message ?? '').not.toContain('No credential configured')
      expect(status).toBe(200)
    } finally {
      await server.stop()
    }
  })
})

describe('provider adapter resolution with a UUID provider id', () => {
  // The real DB stores a UUID as provider.id, and virtual_model.provider_id
  // points at that UUID (see ProviderRepository.create -> randomUUID). The
  // gateway must resolve the provider adapter by the provider's TYPE, not by
  // that UUID — the registry is keyed by type/adapter id ('deepseek', 'opencode').
  it('routes chat to the adapter for the provider type, not the raw UUID', async () => {
    const db = await openDatabase(':memory:')
    try {
      const providerRepo = new ProviderRepository(db)
      const vmRepo = new VirtualModelRepository(db)
      const modelRepo = new ModelRepository(db)
      const providerId = 'cbdad16d-0beb-4f60-aa10-bdbbf22e8929'
      providerRepo.create({ id: providerId, type: 'deepseek', display_name: 'DeepSeek' })
      modelRepo.create({ provider_id: providerId, provider_model_id: 'deepseek-chat', display_name: 'DeepSeek Chat' })
      vmRepo.create({ display_name: 'meo-ds-01', provider_id: providerId, provider_model_id: 'deepseek-chat' })
      const service = new VirtualModelService(vmRepo, null, providerRepo)

      const registry = new ProviderRegistry()
      registry.register(makeFakeAdapter('deepseek'))

      const server = createGatewayServer(
        {
          registry,
          getCredential: async () => 'sk-test',
          resolveModel: (id) => service.resolveModel(id),
          listModels: () => service.listModels(),
          recordUsage: async () => {}
        },
        { host: DEFAULT_HOST, port: 0 }
      )
      const addr = await server.start()
      try {
        const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'meo-ds-01', messages: [{ role: 'user', content: 'hi' }] })
        })
        // A raw Error from registry.require(uuid) surfaces as INTERNAL_ERROR.
        // A successful chat proves the adapter was found by provider type.
        expect(body.error?.code).toBeUndefined()
        expect(status).toBe(200)
        expect(body.choices[0].message.content).toContain('Hello from deepseek')
      } finally {
        await server.stop()
      }
    } finally {
      closeDatabase(db)
    }
  })
})

describe('assistant tool_calls forwarding', () => {
  it('keeps assistant tool_calls intact across the gateway', async () => {
    // A tool-use conversation includes assistant messages that carry tool_calls
    // and no content. If the gateway drops tool_calls, the upstream provider
    // rejects with "content or tool_calls must be set".
    const seen: Array<NormalizedChatRequest['messages']> = []
    const registry = new ProviderRegistry()
    registry.register({
      id: 'openai',
      async getModels() { return [] },
      async validateCredentials() { return { ok: true, message: 'ok' } },
      async *chat(_ctx: unknown, req: NormalizedChatRequest) {
        seen.push(req.messages)
        yield { id: 'c1', kind: 'content_delta', delta: 'ok' }
        yield { id: 'c1', kind: 'finish', finishReason: 'stop' }
      }
    } as unknown as ProviderAdapter)

    const harness = makeHarness()
    const { server, addr } = await startServer({ ...harness.deps, registry })
    const toolCalls = [{ id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{}' } }]
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'user', content: 'What is the weather?' },
            { role: 'assistant', content: null, tool_calls: toolCalls },
            { role: 'tool', tool_call_id: 'call_abc', content: 'sunny' }
          ]
        })
      })
      expect(status).toBe(200)
      const assistant = seen[0]?.find((m) => m.role === 'assistant')
      expect(assistant?.toolCalls).toEqual(toolCalls)
    } finally {
      await server.stop()
    }
  })
})

describe('provider base URL routing', () => {
  it('hands the adapter the base URL the provider was configured with', async () => {
    // Without this the OpenAI-compatible adapter falls back to its DEFAULT_BASE_URL,
    // so a request meant for opencode Zen or Groq is sent to api.openai.com.
    const seen: Array<string | undefined> = []
    const registry = new ProviderRegistry()
    registry.register({
      id: 'openai',
      async getModels() { return [] },
      async validateCredentials() { return { ok: true, message: 'ok' } },
      async *chat(ctx: { baseUrl?: string }) {
        seen.push(ctx.baseUrl)
        yield { id: 'c1', kind: 'content_delta', delta: 'ok' }
      }
    } as unknown as ProviderAdapter)

    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      registry,
      resolveModel: async () => ({
        providerId: 'openai',
        providerModelId: 'deepseek-v4-flash-vision-exp',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        model: {
          id: 'meo-ds-v4-flash-vision',
          providerModelId: 'deepseek-v4-flash-vision-exp',
          displayName: 'meo-ds-v4-flash-vision',
          capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: true }
        }
      })
    })
    try {
      await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'meo-ds-v4-flash-vision', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(seen).toEqual(['https://opencode.ai/zen/go/v1'])
    } finally {
      await server.stop()
    }
  })
})
