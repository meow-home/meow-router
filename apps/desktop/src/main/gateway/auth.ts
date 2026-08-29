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

// Why a request was rejected. For the gateway log only — the client-facing body
// stays uniform so a caller cannot probe for which half of the check it failed.
export type AuthFailure =
  | 'missing_header'
  | 'unsupported_scheme'
  | 'empty_token'
  | 'no_key_configured'
  | 'key_mismatch'

export type AuthOutcome =
  | { ok: true }
  | { ok: false; status: 401; reason: AuthFailure; body: GatewayErrorBody }

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

// Distinguishes the two ways a header can carry no usable token: the wrong
// scheme, and the right scheme with nothing after it.
function bearerToken(authorization: string): { scheme: string; token: string } {
  const [scheme, ...rest] = authorization.trim().split(/\s+/)
  return { scheme: scheme.toLowerCase(), token: rest.join(' ') }
}

function reject(reason: AuthFailure): AuthOutcome {
  return { ok: false, status: 401, reason, body: AUTH_REQUIRED }
}

export function checkAuth(req: AuthRequest, policy: AuthPolicy): AuthOutcome {
  if (!policy.enabled) return { ok: true }
  // A health check that needs a key stops being a health check.
  if (req.method === 'GET' && req.pathname === '/health') return { ok: true }

  if (!policy.key) return reject('no_key_configured')

  if (!req.authorization) return reject('missing_header')
  const { scheme, token } = bearerToken(req.authorization)
  if (scheme !== 'bearer') return reject('unsupported_scheme')
  if (token.length === 0) return reject('empty_token')

  return safeEqual(token, policy.key) ? { ok: true } : reject('key_mismatch')
}
