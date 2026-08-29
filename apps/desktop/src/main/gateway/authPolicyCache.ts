// Caches the resolved auth policy for the request path.
//
// Without this, every request — including every streaming completion — would
// decrypt the credential store. Rotation still takes effect immediately because
// the code paths that change the key or the config also call invalidate().

import type { AuthPolicy } from './auth'

export interface AuthPolicyCache {
  get(): Promise<AuthPolicy>
  invalidate(): void
}

export interface AuthPolicyCacheDeps {
  isAuthEnabled: () => boolean
  readKey: () => Promise<string | null>
}

export function createAuthPolicyCache(deps: AuthPolicyCacheDeps): AuthPolicyCache {
  // Cache the in-flight promise, not just the value, so concurrent first
  // requests share one credential-store read.
  let pending: Promise<string | null> | null = null

  return {
    async get(): Promise<AuthPolicy> {
      if (!pending) pending = deps.readKey()
      const key = await pending
      // Read the flag every time: it is a cheap in-memory lookup, and it keeps
      // the toggle responsive without an extra invalidate path.
      return { enabled: deps.isAuthEnabled(), key }
    },
    invalidate(): void {
      pending = null
    }
  }
}
