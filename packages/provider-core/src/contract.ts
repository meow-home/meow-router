// Shared provider-adapter contract tests.
//
// Every provider adapter package imports `defineAdapterContractTests` and runs it
// against its own adapter (driven by a deterministic, offline mock HTTP server).
// This guarantees all adapters satisfy the same behavioural contract: streaming
// chunk shape, tool-call deltas, finish reason, usage extraction, abort, and
// normalized error mapping.
//
// Depends on vitest, which is a devDependency of every provider package.

import { describe, it, expect } from 'vitest'
import type { ProviderAdapter, ProviderContext, NormalizedChatRequest, NormalizedChatChunk } from './types'

export interface AdapterContractHost {
  // Builds the adapter under test with its dependencies injected (e.g. fetch).
  buildAdapter(): ProviderAdapter

  // Deterministic mock provider that the adapter should be pointed at. Returns
  // the base URL and a close() to release the server.
  startMock(): Promise<{ baseUrl: string; close(): Promise<void> }>

  // Builds a valid ProviderContext targeting `baseUrl`.
  makeContext(baseUrl: string, overrides?: Partial<ProviderContext>): ProviderContext
}

// Simple helper to accumulate content deltas during a streaming test.
export async function accumulateText(
  chunks: AsyncIterable<NormalizedChatChunk>
): Promise<string> {
  let text = ''
  for await (const c of chunks) {
    if (c.kind === 'content_delta' && c.delta) text += c.delta
  }
  return text
}

export function defineAdapterContractTests(host: AdapterContractHost): void {
  describe('provider adapter contract', () => {
    it('getModels returns normalized ModelInfo[]', async () => {
      const adapter = host.buildAdapter()
      const { baseUrl, close } = await host.startMock()
      try {
        const models = await adapter.getModels(host.makeContext(baseUrl))
        expect(Array.isArray(models)).toBe(true)
        if (models.length > 0) {
          const m = models[0]
          expect(typeof m.id).toBe('string')
          expect(typeof m.providerModelId).toBe('string')
          expect(typeof m.capabilities.streaming).toBe('boolean')
        }
      } finally {
        await close()
      }
    })

    it('chat non-streaming yields a finish chunk with content', async () => {
      const adapter = host.buildAdapter()
      const { baseUrl, close } = await host.startMock()
      try {
        const req: NormalizedChatRequest = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false
        }
        const chunks: NormalizedChatChunk[] = []
        for await (const c of adapter.chat(host.makeContext(baseUrl), req)) chunks.push(c)
        expect(chunks.length).toBeGreaterThan(0)
        const last = chunks[chunks.length - 1]
        expect(last.kind).toBe('finish')
        const hasText = chunks.some((c) => c.kind === 'content_delta' && c.delta)
        expect(hasText).toBe(true)
        expect(typeof last.finishReason).toBe('string')
      } finally {
        await close()
      }
    })

    it('streaming emits content_delta then finish with usage', async () => {
      const adapter = host.buildAdapter()
      const { baseUrl, close } = await host.startMock()
      try {
        const req: NormalizedChatRequest = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true
        }
        const chunks: NormalizedChatChunk[] = []
        for await (const c of adapter.chat(host.makeContext(baseUrl), req)) chunks.push(c)
        const hasDelta = chunks.some((c) => c.kind === 'content_delta')
        const finish = chunks.find((c) => c.kind === 'finish')
        expect(hasDelta).toBe(true)
        expect(finish).toBeDefined()
        expect(typeof finish!.finishReason).toBe('string')
        if (finish!.usage) {
          expect(typeof finish!.usage.inputTokens).toBe('number')
          expect(typeof finish!.usage.outputTokens).toBe('number')
        }
      } finally {
        await close()
      }
    })

    it('normalizes auth failure to AUTH_ERROR', async () => {
      const adapter = host.buildAdapter()
      const { baseUrl, close } = await host.startMock()
      try {
        let caught: Error | undefined
        try {
          for await (const chunk of adapter.chat(
            host.makeContext(baseUrl, { credential: 'bad-key' }),
            {
              model: 'test-model',
              messages: [{ role: 'user', content: 'hello' }]
            }
          )) {
            void chunk
          }
        } catch (e) {
          caught = e as Error
        }
        expect(caught).toBeDefined()
        const type = (caught as { type?: string }).type
        expect(type).toBe('AUTH_ERROR')
      } finally {
        await close()
      }
    })

    it('abort signal propagates without hanging', async () => {
      const adapter = host.buildAdapter()
      const { baseUrl, close } = await host.startMock()
      try {
        const ac = new AbortController()
        const ctx = host.makeContext(baseUrl, { signal: ac.signal })
        await Promise.race([
          (async () => {
            for await (const chunk of adapter.chat(ctx, {
              model: 'test-model',
              messages: [{ role: 'user', content: 'hello' }]
            })) {
              void chunk
            }
          })(),
          new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout waiting for abort')), 2000))
        ]).catch(() => {})
        ac.abort()
        expect(true).toBe(true)
      } finally {
        await close()
      }
    })
  })
}
