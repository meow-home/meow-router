import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { generatePkcePair } from './pkce'

describe('generatePkcePair', () => {
  it('generates a valid code_verifier (43-128 chars, base64url, random)', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(a.codeVerifier.length).toBeLessThanOrEqual(128)
    // base64url alphabet
    expect(a.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
    expect(a.codeChallenge).not.toBe(b.codeChallenge)
  })
  it('codeChallenge is base64url(SHA256(codeVerifier))', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair()
    const expected = createHash('sha256').update(codeVerifier).digest('base64url')
    expect(codeChallenge).toBe(expected)
  })
})
