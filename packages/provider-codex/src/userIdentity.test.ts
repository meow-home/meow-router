import { describe, it, expect } from 'vitest'
import { decodeIdToken } from './userIdentity'

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function makeJwt(payload: unknown): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.x`
}

describe('decodeIdToken', () => {
  it('extracts email, sub and name from a JWT payload', () => {
    const decoded = decodeIdToken(makeJwt({ sub: 'u-1', email: 'a@b.com', name: 'A B' }))
    expect(decoded.email).toBe('a@b.com')
    expect(decoded.sub).toBe('u-1')
    expect(decoded.name).toBe('A B')
  })
  it('is tolerant of missing claims', () => {
    expect(decodeIdToken(makeJwt({ sub: 'u-2' }))).toEqual({ sub: 'u-2' })
  })
  it('throws on a non-JWT id_token', () => {
    expect(() => decodeIdToken('not-a-jwt')).toThrow()
  })
})
