import { describe, it, expect } from 'vitest'
import { checkAuth, type AuthPolicy } from './auth'

const KEY = 'mgw_0123456789abcdef0123456789ab1f4a'
const on: AuthPolicy = { enabled: true, key: KEY }

function req(authorization?: string, pathname = '/v1/chat/completions', method = 'POST') {
  return { method, pathname, authorization }
}

describe('checkAuth', () => {
  it('passes everything when auth is disabled', () => {
    expect(checkAuth(req(), { enabled: false, key: null }).ok).toBe(true)
  })

  it('passes GET /health even with auth on and no header', () => {
    expect(checkAuth(req(undefined, '/health', 'GET'), on).ok).toBe(true)
  })

  it('rejects a missing Authorization header', () => {
    const out = checkAuth(req(), on)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.status).toBe(401)
    expect(out.body.error.code).toBe('GATEWAY_AUTH_REQUIRED')
  })

  it('rejects a non-Bearer scheme', () => {
    expect(checkAuth(req(`Basic ${KEY}`), on).ok).toBe(false)
  })

  it('rejects a wrong key', () => {
    expect(checkAuth(req('Bearer mgw_ffffffffffffffffffffffffffffffff'), on).ok).toBe(false)
  })

  it('rejects a key of a different length without throwing', () => {
    expect(checkAuth(req('Bearer short'), on).ok).toBe(false)
  })

  it('accepts the correct key', () => {
    expect(checkAuth(req(`Bearer ${KEY}`), on).ok).toBe(true)
  })

  it('accepts a lowercase bearer scheme', () => {
    expect(checkAuth(req(`bearer ${KEY}`), on).ok).toBe(true)
  })

  it('fails closed when auth is on but no key could be resolved', () => {
    const out = checkAuth(req(`Bearer ${KEY}`), { enabled: true, key: null })
    expect(out.ok).toBe(false)
  })

  it('names why it rejected, for the gateway log', () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'missing_header'],
      [`Basic ${KEY}`, 'unsupported_scheme'],
      ['Bearer wrong', 'key_mismatch']
    ]
    for (const [header, reason] of cases) {
      const out = checkAuth(req(header), on)
      if (out.ok) throw new Error(`expected rejection for ${reason}`)
      expect(out.reason).toBe(reason)
    }
  })

  it('distinguishes an unconfigured key from a wrong one', () => {
    const out = checkAuth(req(`Bearer ${KEY}`), { enabled: true, key: null })
    if (out.ok) throw new Error('expected rejection')
    expect(out.reason).toBe('no_key_configured')
  })

  it('keeps the reason out of the client-facing body', () => {
    const out = checkAuth(req(), on)
    if (out.ok) throw new Error('expected rejection')
    expect(JSON.stringify(out.body)).not.toContain('missing_header')
  })

  it('never echoes the expected key in the error body', () => {
    const out = checkAuth(req('Bearer wrong'), on)
    if (out.ok) throw new Error('expected rejection')
    expect(JSON.stringify(out.body)).not.toContain(KEY)
  })
})
