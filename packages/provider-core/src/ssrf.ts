// SSRF guard for custom provider endpoints (T801).
//
// A custom provider base URL is attacker-influenceable (provider config). When
// it points at loopback, private, link-local, or cloud metadata addresses the
// gateway could be used as an SSRF proxy. This helper rejects those targets
// before any request is sent, unless an explicit allow-local flag is set.
//
// Provider-neutral, dependency-free, easily unit-tested.

export interface SsrfGuardOptions {
  allowLoopback?: boolean
  allowPrivate?: boolean
  allowLinkLocal?: boolean
  allowMetadata?: boolean
}

const PRIVATE_HOST_RE = /^(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./
const LOOPBACK_RE = /^localhost$|^127\.|^::1$|^0\.0\.0\.0$|^\[::1\]$/
const LINK_LOCAL_RE = /^169\.254\.|^fe80:/i
const METADATA_RE = /^169\.254\.169\.254$|^metadata(\.google\.internal)?$/i
const INVALID_HOST_RE = /[^\w.:[\]-]/

export interface SsrfCheckResult {
  ok: boolean
  reason?: string
}

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname)
}

// Validates a full URL (or a bare host:port) against the SSRF rules.
// Throws a plain Error with a user-facing message on violation.
export function assertSafeEndpoint(
  rawUrl: string,
  opts: SsrfGuardOptions = {}
): SsrfCheckResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    // Not a full URL; treat as host[:port].
    const host = rawUrl.split(':')[0]
    if (!host || INVALID_HOST_RE.test(host)) {
      return { ok: false, reason: 'Invalid endpoint host.' }
    }
    return classifyHost(host, opts)
  }

  return classifyHost(url.hostname, opts)
}

function classifyHost(hostname: string, opts: SsrfGuardOptions): SsrfCheckResult {
  const host = hostname.toLowerCase()
  const isLoopback = LOOPBACK_RE.test(host)

  if (METADATA_RE.test(host) && !opts.allowMetadata) {
    return { ok: false, reason: 'Cloud metadata endpoints are not allowed.' }
  }
  if (LINK_LOCAL_RE.test(host) && !opts.allowLinkLocal) {
    return { ok: false, reason: 'Link-local provider endpoints are not allowed.' }
  }
  // Loopback is its own category; `allowLoopback` overrides it regardless of the
  // private-range check (127.0.0.1 is both loopback and RFC1918-ish).
  if (isLoopback) {
    return opts.allowLoopback ? { ok: true } : { ok: false, reason: 'Loopback provider endpoints are not allowed.' }
  }
  if (isPrivateHost(host) && !opts.allowPrivate) {
    return { ok: false, reason: 'Private provider endpoints are not allowed.' }
  }
  return { ok: true }
}
