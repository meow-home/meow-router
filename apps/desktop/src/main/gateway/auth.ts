// Gateway request authentication.
//
// A pure function over a description of the request, so it is tested without
// binding a port. It never logs, never echoes the expected key, and compares in
// constant time.

import { timingSafeEqual } from 'node:crypto'
import type { GatewayErrorBody } from './errors'

export interface AuthPolicy {
  enabled: boolean
  // null means no key could be resolved. With `enabled` true this fails closed.
  key: string | null
}

export interface AuthRequest {
  method: string
  pathname: string
  authorization: string | undefined
}

export type AuthOutcome = { ok: true } | { ok: false; status: 401; body: GatewayErrorBody }

// The gateway's own auth failure. Distinct from PROVIDER_AUTH_FAILED, which
// means an upstream provider rejected our credentials — a different fix for
// the user.
const AUTH_REQUIRED: GatewayErrorBody = {
  error: {
    message: 'Missing or invalid gateway API key.',
    type: 'invalid_request_error',
    code: 'GATEWAY_AUTH_REQUIRED'
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // timingSafeEqual throws on length mismatch; a differing length is already a
  // mismatch, and the length of a rejected guess is not a secret.
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const [scheme, ...rest] = authorization.trim().split(/\s+/)
  if (scheme.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ')
  return token.length > 0 ? token : null
}

export function checkAuth(req: AuthRequest, policy: AuthPolicy): AuthOutcome {
  if (!policy.enabled) return { ok: true }
  // A health check that needs a key stops being a health check.
  if (req.method === 'GET' && req.pathname === '/health') return { ok: true }

  const reject: AuthOutcome = { ok: false, status: 401, body: AUTH_REQUIRED }
  if (!policy.key) return reject

  const token = bearerToken(req.authorization)
  if (!token) return reject
  return safeEqual(token, policy.key) ? { ok: true } : reject
}
