import { describe, it, expect } from 'vitest'
import { ERROR_TYPES, ProviderError, ProviderRegistry } from './index'
import type { GatewayErrorType, ProviderAdapter } from './index'

describe('provider-core types', () => {
  it('exposes the normalized gateway error taxonomy', () => {
    expect(ERROR_TYPES).toContain('RATE_LIMIT')
    expect(ERROR_TYPES).toContain('AUTH_ERROR')
  })

  it('GatewayErrorType unions the ERROR_TYPES values', () => {
    const sample: GatewayErrorType = 'TIMEOUT'
    expect(ERROR_TYPES).toContain(sample)
  })

  it('ProviderError carries normalized metadata', () => {
    const err = new ProviderError({
      type: 'RATE_LIMIT',
      message: 'rate limited',
      status: 429,
      retryable: true,
      retryAfterMs: 5000
    })
    expect(err.type).toBe('RATE_LIMIT')
    expect(err.status).toBe(429)
    expect(err.retryable).toBe(true)
    expect(err.retryAfterMs).toBe(5000)
    expect(err.name).toBe('ProviderError')
  })

  it('ProviderError default retryable is false when omitted', () => {
    const err = new ProviderError({ type: 'CLIENT_ERROR', message: 'bad request' })
    expect(err.retryable).toBe(false)
  })
})

describe('ProviderRegistry', () => {
  const makeAdapter = (id: string): ProviderAdapter => ({
    id,
    getModels: async () => [],
    validateCredentials: async () => ({ ok: true, message: 'ok' }),
    chat: async function* () {
      yield { id: '1', kind: 'finish', finishReason: 'stop' }
    }
  })

  it('registers and resolves adapters by id', () => {
    const reg = new ProviderRegistry()
    reg.register(makeAdapter('deepseek'))
    expect(reg.get('deepseek')).toBeDefined()
    expect(reg.ids()).toEqual(['deepseek'])
  })

  it('require throws for an unknown adapter', () => {
    const reg = new ProviderRegistry()
    expect(() => reg.require('nope')).toThrow(/No provider adapter registered/)
  })

  it('rejects duplicate registration', () => {
    const reg = new ProviderRegistry()
    reg.register(makeAdapter('openai'))
    expect(() => reg.register(makeAdapter('openai'))).toThrow(/already registered/)
  })

  it('unregister removes an adapter', () => {
    const reg = new ProviderRegistry()
    reg.register(makeAdapter('openai'))
    expect(reg.unregister('openai')).toBe(true)
    expect(reg.get('openai')).toBeUndefined()
  })
})
