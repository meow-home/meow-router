import { describe, it, expect } from 'vitest'
import {
  GATEWAY_KEY_REF,
  generateGatewayKey,
  maskGatewayKey,
  ensureGatewayKey,
  regenerateGatewayKey,
  type GatewayKeyStore
} from './gatewayKey'

function makeStore(initial?: string): GatewayKeyStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  if (initial) values.set(GATEWAY_KEY_REF, initial)
  return {
    values,
    async hasCredential(ref) {
      return values.has(ref)
    },
    async getCredential(ref) {
      return values.get(ref) ?? null
    },
    async setCredential(ref, secret) {
      values.set(ref, secret)
    }
  }
}

describe('generateGatewayKey', () => {
  it('produces a prefixed 32-hex key', () => {
    expect(generateGatewayKey()).toMatch(/^mgw_[0-9a-f]{32}$/)
  })

  it('produces a different key each call', () => {
    expect(generateGatewayKey()).not.toBe(generateGatewayKey())
  })
})

describe('maskGatewayKey', () => {
  it('reveals only the last four characters', () => {
    const masked = maskGatewayKey('mgw_0123456789abcdef0123456789ab1f4a')
    expect(masked).toBe('mgw_•••••••••••1f4a')
    expect(masked).not.toContain('0123456789')
  })

  it('uses a fixed bullet run that does not leak the hidden length', () => {
    const masked = maskGatewayKey('mgw_0123456789abcdef0123456789ab1f4a')
    expect(masked.split('•').length - 1).toBe(11)
  })

  it('renders an absent key without inventing one', () => {
    expect(maskGatewayKey(null)).toBe('')
  })
})

describe('ensureGatewayKey', () => {
  it('generates and stores a key when none exists', async () => {
    const store = makeStore()
    const key = await ensureGatewayKey(store)
    expect(key).toMatch(/^mgw_[0-9a-f]{32}$/)
    expect(store.values.get(GATEWAY_KEY_REF)).toBe(key)
  })

  it('never overwrites an existing key', async () => {
    const store = makeStore('mgw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const key = await ensureGatewayKey(store)
    expect(key).toBe('mgw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(store.values.get(GATEWAY_KEY_REF)).toBe('mgw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })
})

describe('regenerateGatewayKey', () => {
  it('replaces an existing key', async () => {
    const store = makeStore('mgw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const key = await regenerateGatewayKey(store)
    expect(key).not.toBe('mgw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(store.values.get(GATEWAY_KEY_REF)).toBe(key)
  })
})

describe('key info shape', () => {
  it('reports absence without a masked string', () => {
    expect({ masked: maskGatewayKey(null), present: false }).toEqual({ masked: '', present: false })
  })
})
