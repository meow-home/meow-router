# Gateway API Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the gateway a real API key — generated at bootstrap, enforced on every request, shown masked in the UI — and turn the currently-dead "Require gateway API key" checkbox into a working control that is on by default.

**Architecture:** Two pure modules (`gatewayKey.ts` for generation/masking, `auth.ts` for the request check) are consumed by the HTTP server through a new optional dependency `getAuthPolicy()`. A small main-process cache resolves that policy so the credential store is not decrypted on every request, and invalidates when the key or config changes. The renderer only ever receives a masked string; copying the real key happens in the main process.

**Tech Stack:** TypeScript (strict), Electron main/preload/renderer split, node:http, node:crypto, better-sqlite3-style migrations, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-29-gateway-api-key-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- Key format: `mgw_` followed by 32 lowercase hex characters, from `crypto.randomBytes(16)`.
- Credential ref: `gateway:local-key`, stored through the existing `CredentialService` (safeStorage). Never in SQLite.
- Mask format: `mgw_` + 11 `•` characters + the final 4 hex characters. The bullet count is **fixed at 11** and deliberately does not match the 28 hidden characters — the mask must not leak the key's length.
- The raw key never crosses the preload bridge. It must not appear in renderer state or devtools.
- Never log the `Authorization` header or the key — not in `logger.*`, not in tests, not in fixtures or snapshots.
- Key comparison uses `crypto.timingSafeEqual`, never `===`.
- `GET /health` never requires auth.
- **Fail closed:** `auth_enabled` true with no resolvable key rejects every request with 401. Never fall back to serving unauthenticated traffic.
- Key generation is idempotent — an existing key is never overwritten.
- The gateway stays bound to loopback. This plan changes nothing about binding.

### Deviation from the spec (deliberate, adopted here)

Spec §5.1 says the 401 body "goes through the existing `toGatewayErrorBody` taxonomy". Following that literally is wrong: `gatewayErrorCode` maps `AUTH_ERROR` to `PROVIDER_AUTH_FAILED` (`main/gateway/errors.ts:41`), which would tell a user their *provider* key is bad when their *gateway* key is bad. This plan keeps the `GatewayErrorBody` **envelope** but uses code `GATEWAY_AUTH_REQUIRED`. Task 8 updates the spec and `docs/API.md` to match.

### Task order rationale

Enabling auth by default (Task 7) is the breaking change. It lands **after** the UI that shows the key (Task 6), so no commit in this sequence leaves a user locked out with no way to read their key.

---

### Task 1: Key generation and masking

**Files:**
- Create: `apps/desktop/src/main/gateway/gatewayKey.ts`
- Test: `apps/desktop/src/main/gateway/gatewayKey.test.ts`

**Interfaces:**
- Consumes: `CredentialService` from `apps/desktop/src/main/credentials/credentialService.ts` (`hasCredential`, `getCredential`, `setCredential`).
- Produces:
  - `GATEWAY_KEY_REF: 'gateway:local-key'`
  - `generateGatewayKey(): string`
  - `maskGatewayKey(key: string | null): string`
  - `ensureGatewayKey(credentials: GatewayKeyStore): Promise<string>`
  - `regenerateGatewayKey(credentials: GatewayKeyStore): Promise<string>`
  - `interface GatewayKeyStore { hasCredential(ref: string): Promise<boolean>; getCredential(ref: string): Promise<string | null>; setCredential(ref: string, secret: string): Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/gateway/gatewayKey.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/gateway/gatewayKey.test.ts`
Expected: FAIL — `Failed to resolve import "./gatewayKey"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/main/gateway/gatewayKey.ts`:

```ts
// Local gateway key: generation, masking and credential-store access.
//
// The key authenticates clients against THIS gateway. It is unrelated to
// provider credentials and is never written to SQLite.

import { randomBytes } from 'node:crypto'

export const GATEWAY_KEY_REF = 'gateway:local-key'

const KEY_PREFIX = 'mgw_'
// Fixed-width bullet run: the mask must not disclose how long the key is.
const MASK_BULLETS = '•'.repeat(11)
const VISIBLE_TAIL = 4

// Narrow view of CredentialService — everything this module needs, nothing more.
export interface GatewayKeyStore {
  hasCredential(ref: string): Promise<boolean>
  getCredential(ref: string): Promise<string | null>
  setCredential(ref: string, secret: string): Promise<void>
}

export function generateGatewayKey(): string {
  return KEY_PREFIX + randomBytes(16).toString('hex')
}

export function maskGatewayKey(key: string | null): string {
  if (!key) return ''
  return KEY_PREFIX + MASK_BULLETS + key.slice(-VISIBLE_TAIL)
}

// Idempotent: returns the stored key, generating one only when absent.
export async function ensureGatewayKey(credentials: GatewayKeyStore): Promise<string> {
  if (await credentials.hasCredential(GATEWAY_KEY_REF)) {
    const existing = await credentials.getCredential(GATEWAY_KEY_REF)
    if (existing) return existing
  }
  const key = generateGatewayKey()
  await credentials.setCredential(GATEWAY_KEY_REF, key)
  return key
}

// Unlike ensureGatewayKey, this deliberately replaces the stored key.
export async function regenerateGatewayKey(credentials: GatewayKeyStore): Promise<string> {
  const key = generateGatewayKey()
  await credentials.setCredential(GATEWAY_KEY_REF, key)
  return key
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/gateway/gatewayKey.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gateway/gatewayKey.ts apps/desktop/src/main/gateway/gatewayKey.test.ts
git commit -m "feat(gateway): add gateway key generation, masking and storage"
```

---

### Task 2: The auth check

**Files:**
- Create: `apps/desktop/src/main/gateway/auth.ts`
- Test: `apps/desktop/src/main/gateway/auth.test.ts`

**Interfaces:**
- Consumes: `GatewayErrorBody` from `apps/desktop/src/main/gateway/errors.ts`.
- Produces:
  - `interface AuthPolicy { enabled: boolean; key: string | null }`
  - `interface AuthRequest { method: string; pathname: string; authorization: string | undefined }`
  - `type AuthOutcome = { ok: true } | { ok: false; status: 401; body: GatewayErrorBody }`
  - `checkAuth(req: AuthRequest, policy: AuthPolicy): AuthOutcome`

`checkAuth` takes a plain `AuthRequest`, not an `IncomingMessage`, so it is testable without a socket.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/gateway/auth.test.ts`:

```ts
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

  it('never echoes the expected key in the error body', () => {
    const out = checkAuth(req('Bearer wrong'), on)
    if (out.ok) throw new Error('expected rejection')
    expect(JSON.stringify(out.body)).not.toContain(KEY)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/gateway/auth.test.ts`
Expected: FAIL — `Failed to resolve import "./auth"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/main/gateway/auth.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/gateway/auth.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gateway/auth.ts apps/desktop/src/main/gateway/auth.test.ts
git commit -m "feat(gateway): add the request auth check"
```

---

### Task 3: Enforce auth in the HTTP server

**Files:**
- Modify: `apps/desktop/src/main/gateway/types.ts` (add `getAuthPolicy?` to `GatewayDependencies`, ends line 74)
- Modify: `apps/desktop/src/main/gateway/server.ts:59-97` (`handle`)
- Test: `apps/desktop/src/main/gateway/server.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `checkAuth`, `AuthPolicy` from Task 2.
- Produces: `GatewayDependencies.getAuthPolicy?(): Promise<AuthPolicy>` — optional. When absent the gateway behaves exactly as before, which is what keeps the existing 27 tests untouched. Bootstrap always supplies it (Task 5), so "optional" describes the test seam, never the shipped app.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/main/gateway/server.test.ts`. The file already provides `makeHarness()`, `startServer()` and `fetchJson()` — reuse them.

```ts
describe('gateway auth', () => {
  const KEY = 'mgw_0123456789abcdef0123456789ab1f4a'

  it('rejects a chat completion with no key when auth is on', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status, body } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(401)
      expect(JSON.stringify(body)).not.toContain(KEY)
    } finally {
      await server.stop()
    }
  })

  it('accepts a chat completion with the correct key', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
      })
      expect(status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('serves /health without a key while auth is on', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/health`)
      expect(status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('rejects GET /v1/models without a key', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const { status } = await fetchJson(`http://${addr.host}:${addr.port}/v1/models`)
      expect(status).toBe(401)
    } finally {
      await server.stop()
    }
  })

  it('streams a completion with the correct key', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      const res = await fetch(`http://${addr.host}:${addr.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream: true })
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const frames = (await res.text()).split('
').filter((l) => l.startsWith('data:'))
      expect(frames[frames.length - 1].trim()).toBe('data: [DONE]')
    } finally {
      await server.stop()
    }
  })

  it('never logs the Authorization header', async () => {
    const harness = makeHarness()
    const { server, addr } = await startServer({
      ...harness.deps,
      getAuthPolicy: async () => ({ enabled: true, key: KEY })
    })
    try {
      await fetchJson(`http://${addr.host}:${addr.port}/v1/models`, {
        headers: { authorization: `Bearer ${KEY}` }
      })
      expect(JSON.stringify(harness.logs)).not.toContain(KEY)
    } finally {
      await server.stop()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/gateway/server.test.ts -t "gateway auth"`
Expected: FAIL — the 401 tests return 200, because nothing reads `getAuthPolicy` yet. TypeScript also rejects the unknown property.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/main/gateway/types.ts`, inside `GatewayDependencies` (before `logger?`):

```ts
  // Resolve the current auth policy. Optional: when absent the gateway treats
  // auth as disabled. Bootstrap always supplies it.
  getAuthPolicy?(): Promise<AuthPolicy>
```

and at the top of the file:

```ts
import type { AuthPolicy } from './auth'
```

In `apps/desktop/src/main/gateway/server.ts`, add to the imports:

```ts
import { checkAuth } from './auth'
```

Then in `handle`, immediately after the `const url = new URL(...)` line (currently `server.ts:70`) and **before** the `/health` route:

```ts
      const policy = (await deps.getAuthPolicy?.()) ?? { enabled: false, key: null }
      const auth = checkAuth(
        {
          method: req.method ?? 'GET',
          pathname: url.pathname,
          authorization: req.headers.authorization
        },
        policy
      )
      if (!auth.ok) {
        res.writeHead(auth.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(auth.body))
        // Path only: never the header, never the key.
        logger.warn('unauthorized', { requestId, path: url.pathname })
        return
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/gateway/server.test.ts`
Expected: PASS — the 6 new tests plus all 27 existing ones (33 total).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gateway/types.ts apps/desktop/src/main/gateway/server.ts apps/desktop/src/main/gateway/server.test.ts
git commit -m "feat(gateway): enforce the API key on every request but /health"
```

---

### Task 4: Policy cache

**Files:**
- Create: `apps/desktop/src/main/gateway/authPolicyCache.ts`
- Test: `apps/desktop/src/main/gateway/authPolicyCache.test.ts`

**Interfaces:**
- Consumes: `AuthPolicy` from Task 2.
- Produces:
  - `interface AuthPolicyCache { get(): Promise<AuthPolicy>; invalidate(): void }`
  - `createAuthPolicyCache(deps: { isAuthEnabled: () => boolean; readKey: () => Promise<string | null> }): AuthPolicyCache`

Dependencies are functions, not repository classes, so the cache is tested without a database or a credential store.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/gateway/authPolicyCache.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createAuthPolicyCache } from './authPolicyCache'

describe('createAuthPolicyCache', () => {
  it('resolves the policy from its dependencies', async () => {
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey: async () => 'mgw_k' })
    expect(await cache.get()).toEqual({ enabled: true, key: 'mgw_k' })
  })

  it('reads the key only once across repeated gets', async () => {
    const readKey = vi.fn().mockResolvedValue('mgw_k')
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey })
    await cache.get()
    await cache.get()
    await cache.get()
    expect(readKey).toHaveBeenCalledTimes(1)
  })

  it('re-reads after invalidate', async () => {
    const readKey = vi.fn().mockResolvedValueOnce('mgw_old').mockResolvedValueOnce('mgw_new')
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey })
    expect((await cache.get()).key).toBe('mgw_old')
    cache.invalidate()
    expect((await cache.get()).key).toBe('mgw_new')
  })

  it('does not stampede on concurrent gets', async () => {
    const readKey = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('mgw_k'), 5))
    )
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey })
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(readKey).toHaveBeenCalledTimes(1)
  })

  it('surfaces a missing key as null rather than throwing', async () => {
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey: async () => null })
    expect(await cache.get()).toEqual({ enabled: true, key: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/gateway/authPolicyCache.test.ts`
Expected: FAIL — `Failed to resolve import "./authPolicyCache"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/main/gateway/authPolicyCache.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/gateway/authPolicyCache.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gateway/authPolicyCache.ts apps/desktop/src/main/gateway/authPolicyCache.test.ts
git commit -m "feat(gateway): cache the resolved auth policy"
```

---

### Task 5: IPC channels, preload and bootstrap wiring

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts` (channels at `:66-71`, `WindowApi` at `:32-36`, add `GatewayKeyInfo` near `GatewayStatus` at `:114`)
- Modify: `apps/desktop/src/preload/index.ts:52-56`
- Modify: `apps/desktop/src/main/app/bootstrap.ts` (deps at `:88`, handlers at `:278-285`)
- Modify: `apps/desktop/src/render/src/test/setup.ts` (add the three new mocks)
- Test: `apps/desktop/src/main/app/bootstrap.test.ts`

**Interfaces:**
- Consumes: `ensureGatewayKey`, `regenerateGatewayKey`, `maskGatewayKey`, `GATEWAY_KEY_REF` (Task 1); `createAuthPolicyCache` (Task 4).
- Produces:
  - `IPC_CHANNELS.gateway.getKeyInfo = 'gateway:get-key-info'`, `.copyKey = 'gateway:copy-key'`, `.regenerateKey = 'gateway:regenerate-key'`
  - `interface GatewayKeyInfo { masked: string; present: boolean }`
  - `WindowApi.gatewayGetKeyInfo(): Promise<GatewayKeyInfo>`
  - `WindowApi.gatewayCopyKey(): Promise<void>`
  - `WindowApi.gatewayRegenerateKey(): Promise<GatewayKeyInfo>`

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/main/app/bootstrap.test.ts`:

```ts
describe('gateway key IPC contract', () => {
  it('declares the three key channels', async () => {
    const { IPC_CHANNELS } = await import('../../shared/ipc')
    expect(IPC_CHANNELS.gateway.getKeyInfo).toBe('gateway:get-key-info')
    expect(IPC_CHANNELS.gateway.copyKey).toBe('gateway:copy-key')
    expect(IPC_CHANNELS.gateway.regenerateKey).toBe('gateway:regenerate-key')
  })
})
```

Also add to `apps/desktop/src/main/gateway/gatewayKey.test.ts`:

```ts
describe('key info shape', () => {
  it('reports absence without a masked string', () => {
    expect({ masked: maskGatewayKey(null), present: false }).toEqual({ masked: '', present: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/app/bootstrap.test.ts -t "gateway key IPC contract"`
Expected: FAIL — `expected undefined to be 'gateway:get-key-info'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/shared/ipc.ts`, extend the gateway channel block (`:66`):

```ts
  gateway: {
    getStatus: 'gateway:get-status',
    start: 'gateway:start',
    stop: 'gateway:stop',
    getConfig: 'gateway:get-config',
    saveConfig: 'gateway:save-config',
    getKeyInfo: 'gateway:get-key-info',
    copyKey: 'gateway:copy-key',
    regenerateKey: 'gateway:regenerate-key'
```

Add the type near `GatewayStatus` (`:114`):

```ts
// What the renderer is allowed to know about the gateway key. The raw key is
// never part of this type — see docs/SECURITY.md.
export interface GatewayKeyInfo {
  masked: string
  present: boolean
}
```

Add to `WindowApi` after `gatewaySaveConfig` (`:36`):

```ts
  gatewayGetKeyInfo(): Promise<GatewayKeyInfo>
  gatewayCopyKey(): Promise<void>
  gatewayRegenerateKey(): Promise<GatewayKeyInfo>
```

In `apps/desktop/src/preload/index.ts` after line 56:

```ts
  gatewayGetKeyInfo: () => invoke<GatewayKeyInfo>(IPC_CHANNELS.gateway.getKeyInfo),
  gatewayCopyKey: () => invoke<void>(IPC_CHANNELS.gateway.copyKey),
  gatewayRegenerateKey: () => invoke<GatewayKeyInfo>(IPC_CHANNELS.gateway.regenerateKey),
```

adding `GatewayKeyInfo` to the type import from `../shared/ipc`.

In `apps/desktop/src/main/app/bootstrap.ts`, add imports:

```ts
import { clipboard } from 'electron'   // extend the existing electron import
import {
  GATEWAY_KEY_REF,
  ensureGatewayKey,
  regenerateGatewayKey,
  maskGatewayKey
} from '../gateway/gatewayKey'
import { createAuthPolicyCache } from '../gateway/authPolicyCache'
import type { GatewayKeyInfo } from '../../shared/ipc'
```

Before `const deps: GatewayDependencies` (`:88`):

```ts
  // A key must exist before the gateway can ever be started, so the Gateway
  // view has something to show on a fresh install.
  await ensureGatewayKey(credentials)

  const authPolicy = createAuthPolicyCache({
    isAuthEnabled: () => configRepo.get().auth_enabled,
    readKey: () => credentials.getCredential(GATEWAY_KEY_REF)
  })
```

Add to `deps`:

```ts
    getAuthPolicy: () => authPolicy.get(),
```

Pass `authPolicy` and `credentials` into `registerIpcHandlers({ ... })` (`:106`) and add them to its parameter type alongside `configRepo`.

Invalidate on save — replace the `saveConfig` handler (`:282`):

```ts
  ipcMain.handle(IPC_CHANNELS.gateway.saveConfig, async (_e, cfg: NewGatewayConfig): Promise<IpcResult<GatewayConfigRow>> => {
    if (!isValidGatewayConfig(cfg)) return badRequest('Invalid gateway config.', 'INVALID_GATEWAY')
    return wrap(() => {
      const saved = configRepo.save(cfg)
      authPolicy.invalidate()
      return saved
    })
  })

  ipcMain.handle(IPC_CHANNELS.gateway.getKeyInfo, async (): Promise<IpcResult<GatewayKeyInfo>> => {
    return wrap(async () => {
      const key = await credentials.getCredential(GATEWAY_KEY_REF)
      return { masked: maskGatewayKey(key), present: key !== null }
    })
  })

  ipcMain.handle(IPC_CHANNELS.gateway.copyKey, async (): Promise<IpcResult<void>> => {
    return wrap(async () => {
      const key = await credentials.getCredential(GATEWAY_KEY_REF)
      if (!key) throw new Error('No gateway key is stored.')
      // The raw key goes straight to the clipboard; it never returns to the renderer.
      clipboard.writeText(key)
    })
  })

  ipcMain.handle(IPC_CHANNELS.gateway.regenerateKey, async (): Promise<IpcResult<GatewayKeyInfo>> => {
    return wrap(async () => {
      const key = await regenerateGatewayKey(credentials)
      authPolicy.invalidate()
      return { masked: maskGatewayKey(key), present: true }
    })
  })
```

In `apps/desktop/src/render/src/test/setup.ts`, add after `gatewaySaveConfig`:

```ts
    gatewayGetKeyInfo: vi.fn().mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true }),
    gatewayCopyKey: vi.fn().mockResolvedValue(undefined),
    gatewayRegenerateKey: vi.fn().mockResolvedValue({ masked: 'mgw_•••••••••••beef', present: true }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS on all three.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/app/bootstrap.ts apps/desktop/src/main/app/bootstrap.test.ts apps/desktop/src/render/src/test/setup.ts apps/desktop/src/main/gateway/gatewayKey.test.ts
git commit -m "feat(gateway): expose masked key, copy and regenerate over IPC"
```

---

### Task 6: Gateway view UI

**Files:**
- Modify: `apps/desktop/src/render/src/views/GatewayView.tsx`
- Test: `apps/desktop/src/render/src/views/GatewayView.test.tsx`

**Interfaces:**
- Consumes: `gatewayGetKeyInfo`, `gatewayCopyKey`, `gatewayRegenerateKey` (Task 5); `ConfirmDialog`, `Field`, `Button`, `Input` from `../components/ui`.
- Produces: no exports beyond the existing `GatewayView`.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/render/src/views/GatewayView.test.tsx`:

```ts
describe('gateway API key', () => {
  it('shows the masked key and never a raw one', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true })
    render(<GatewayView />)
    expect(await screen.findByText('mgw_•••••••••••1f4a')).toBeTruthy()
  })

  it('copies through the main process', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true })
    render(<GatewayView />)
    fireEvent.click(await screen.findByText('Copy'))
    await waitFor(() => expect(gw.gatewayCopyKey).toHaveBeenCalled())
  })

  it('asks for confirmation before regenerating', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true })
    gw.gatewayRegenerateKey.mockResolvedValue({ masked: 'mgw_•••••••••••beef', present: true })
    render(<GatewayView />)
    fireEvent.click(await screen.findByText('Regenerate'))
    expect(gw.gatewayRegenerateKey).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Regenerate key'))
    await waitFor(() => expect(gw.gatewayRegenerateKey).toHaveBeenCalled())
    expect(await screen.findByText('mgw_•••••••••••beef')).toBeTruthy()
  })

  it('reports a key that could not be read', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: '', present: false })
    render(<GatewayView />)
    expect(await screen.findByText(/could not be read/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/render/src/views/GatewayView.test.tsx -t "gateway API key"`
Expected: FAIL — `Unable to find an element with the text: mgw_•••••••••••1f4a`.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/render/src/views/GatewayView.tsx`:

Extend the imports:

```ts
import type { GatewayStatus, GatewayConfigRow, GatewayKeyInfo } from '@shared/ipc'
import { ViewHeader, Button, Field, ErrorBanner, Pill, Input, Checkbox, Spinner, ConfirmDialog } from '../components/ui'
```

Add state:

```ts
  const [keyInfo, setKeyInfo] = useState<GatewayKeyInfo | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
```

Extend `refresh`:

```ts
  const refresh = async () => {
    const [s, c, k] = await Promise.all([
      window.meowGateway.gatewayGetStatus(),
      window.meowGateway.gatewayGetConfig(),
      window.meowGateway.gatewayGetKeyInfo()
    ])
    setStatus(s); setConfig(c); setKeyInfo(k)
  }
```

Add handlers:

```ts
  async function handleCopyKey() {
    try { await window.meowGateway.gatewayCopyKey() } catch (e) { setError(String(e)) }
  }

  async function handleRegenerate() {
    setConfirmRegen(false)
    try { setKeyInfo(await window.meowGateway.gatewayRegenerateKey()) } catch (e) { setError(String(e)) }
  }
```

Insert the key field after the status panel, before the config form:

```tsx
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Field label="Gateway API key">
          {keyInfo?.present ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ flex: 1 }}>{keyInfo.masked}</span>
              <Button onClick={handleCopyKey}>Copy</Button>
              <Button variant="danger" onClick={() => setConfirmRegen(true)}>Regenerate</Button>
            </div>
          ) : (
            <span style={{ color: 'var(--red)', fontSize: 'var(--fs-1)' }}>
              The gateway key could not be read from the credential store.
            </span>
          )}
        </Field>
      </div>
```

and render the dialog before the closing `</div>` of the view:

```tsx
      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate gateway key"
        message="Every client using the current key stops working until you give it the new one."
        confirmLabel="Regenerate key"
        onConfirm={handleRegenerate}
        onCancel={() => setConfirmRegen(false)}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/render/src/views/GatewayView.test.tsx`
Expected: PASS — 4 new tests plus the 2 existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/views/GatewayView.tsx apps/desktop/src/render/src/views/GatewayView.test.tsx
git commit -m "feat(render): show the masked gateway key with copy and regenerate"
```

---

### Task 7: Turn auth on by default

**Files:**
- Modify: `apps/desktop/src/main/database/migrations.ts` (append migration 6 to `MIGRATIONS`, after the `model_stale` entry ending at `:157`)
- Modify: `apps/desktop/src/main/database/repositories/gatewayConfigRepository.ts:27` (no-row fallback)
- Test: `apps/desktop/src/main/database/database.test.ts` (`GatewayConfigRepository` block at `:176`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new exports. Behaviour change only.

This is the breaking commit. It lands last among the code tasks so the UI from Task 6 can already show the key.

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/main/database/database.test.ts`, change the existing expectation in `'returns defaults when unset'` from `expect(cfg.auth_enabled).toBe(false)` to `expect(cfg.auth_enabled).toBe(true)`, and add to the same describe block:

```ts
  it('turns auth on for a config row written before the migration', () => {
    // Simulate a pre-migration row, then re-run migrations over it.
    db.exec(`
      INSERT INTO gateway_config (id, host, port, auth_enabled, startup_enabled)
      VALUES (1, '127.0.0.1', 8317, 0, 0)
      ON CONFLICT(id) DO UPDATE SET auth_enabled = 0;
      DELETE FROM schema_migrations WHERE version = 6;
    `)
    migrate(db)
    expect(repo.get().auth_enabled).toBe(true)
  })
```

Add `migrate` to the imports at the top of the file:

```ts
import { migrate } from './migrations'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/database/database.test.ts -t "GatewayConfigRepository"`
Expected: FAIL — `expected false to be true` on the defaults test, and the migration test fails because version 6 does not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/main/database/migrations.ts`, append to the `MIGRATIONS` array:

```ts
  ,
  {
    version: 6,
    name: 'gateway_auth_default',
    up: (db) => {
      // The gateway now authenticates by default, including for installs that
      // predate the key. Clients must be given the key from the Gateway view.
      db.exec(`
        UPDATE gateway_config SET auth_enabled = 1;
      `)
    }
  }
```

In `apps/desktop/src/main/database/repositories/gatewayConfigRepository.ts`, change the no-row fallback:

```ts
          auth_enabled: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS on all three. No other fixture needs touching: `render/src/test/setup.ts:22` and `GatewayView.test.tsx:11` do pass `auth_enabled: false`, but they are renderer mocks feeding the checkbox's `defaultChecked`, not assertions about the repository default. `database.test.ts:189` was the only assertion of the old default, and Step 1 already changed it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/database/migrations.ts apps/desktop/src/main/database/repositories/gatewayConfigRepository.ts apps/desktop/src/main/database/database.test.ts
git commit -m "feat(gateway): require the API key by default, including on upgrade"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/API.md:7-17`
- Modify: `docs/SECURITY.md` (the credential section near `:29`, and the acceptance list near `:95`)
- Modify: `README.md` (the Providers section area, around `:20`)
- Modify: `docs/superpowers/specs/2026-08-29-gateway-api-key-design.md` §5.1

- [ ] **Step 1: Rewrite the API authentication section**

Replace `docs/API.md` §Authentication with:

```markdown
## Authentication

The gateway requires an API key by default. Send it as a bearer token:

```
Authorization: Bearer <local-gateway-key>
```

The local gateway key is independent from cloud provider API keys. Find it in
the desktop app under Gateway → Gateway API key; Copy puts the full key on your
clipboard.

`GET /health` never requires the key, so a liveness probe works unauthenticated.

A missing, malformed or wrong key returns 401:

```json
{
  "error": {
    "message": "Missing or invalid gateway API key.",
    "type": "invalid_request_error",
    "code": "GATEWAY_AUTH_REQUIRED"
  }
}
```

Authentication can be turned off in Gateway → Require gateway API key. With it
off the gateway serves any loopback client.
```

- [ ] **Step 2: Record the key's handling in SECURITY.md**

Add to `docs/SECURITY.md`:

```markdown
### Local gateway key

The gateway's own API key is generated on first launch and stored through the
same safeStorage-backed credential service as provider keys, under the ref
`gateway:local-key`. It is never written to SQLite.

The renderer never receives the raw key. It gets a masked form
(`mgw_•••••••••••1f4a`) computed in the main process; Copy writes the real key
to the clipboard from the main process. The mask's bullet run is a fixed width
and does not reveal the key's length.

If `auth_enabled` is on and the key cannot be read, the gateway fails closed —
every request is rejected with 401. It never falls back to serving
unauthenticated traffic.
```

- [ ] **Step 3: Tell README readers where to find the key**

Add to `README.md`, after the gateway description:

```markdown
The gateway requires an API key by default. Open Gateway → Gateway API key and
press Copy, then paste it into your coding agent as the API key for the
`http://127.0.0.1:8317/v1` endpoint.
```

- [ ] **Step 4: Reconcile the spec with what shipped**

In `docs/superpowers/specs/2026-08-29-gateway-api-key-design.md` §5.1, replace
"The 401 body goes through the existing `toGatewayErrorBody` taxonomy" with:

```markdown
The 401 body reuses the `GatewayErrorBody` envelope but carries the code
`GATEWAY_AUTH_REQUIRED`, not `toGatewayErrorBody`'s `PROVIDER_AUTH_FAILED` —
that code means an upstream provider rejected our credentials, a different
problem with a different fix.
```

- [ ] **Step 5: Verify and commit**

Run: `cd apps/desktop && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS on all three (docs do not affect them, but this is the final gate).

```bash
git add docs/API.md docs/SECURITY.md README.md docs/superpowers/specs/2026-08-29-gateway-api-key-design.md
git commit -m "docs: document gateway API key authentication"
```

---

## Verification checklist

After Task 8, confirm end to end:

- [ ] `cd apps/desktop && pnpm test` — all tests pass. Expect roughly 220 (192 today plus ~28 new).
- [ ] `pnpm typecheck` — clean.
- [ ] `pnpm lint` — clean.
- [ ] `grep -rn "mgw_" apps/desktop/src --include=*.ts --include=*.tsx | grep -v test` returns only the prefix constant and mask code — never a literal key.
- [ ] Launch the app: Gateway shows a masked key; Copy puts a full `mgw_…` key on the clipboard; `curl http://127.0.0.1:8317/v1/models` returns 401; the same call with `-H "Authorization: Bearer <key>"` returns 200; `curl http://127.0.0.1:8317/health` returns 200 with no header.
