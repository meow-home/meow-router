# Codex OAuth Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex (OpenAI) as an OAuth-backed provider in meow-gateway, using a PKCE browser-redirect flow against `auth.openai.com` and routing chat completions through the OpenAI Responses API (with chat-completions fallback).

**Architecture:** Extend `oauth-core` with PKCE code-verifier/challenge support (the shared OAuth flow currently only does authorization-code + client_secret for Google/Antigravity). Create a new `provider-codex` package with its own PKCE token client (Codex has no userinfo endpoint — account identity comes from decoding the `id_token` JWT), and a `ProviderAdapter` that forwards requests using the OAuth access token via `OAuthTokenManager` auto-refresh. Wire `codex` into the existing OAuth login service via the `tokenClientForType` DI hook that Antigravity already established.

**Tech Stack:** TypeScript strict mode, pnpm workspaces, vitest, Electron main process. Provider packages depend only on `@meow-gateway/provider-core` and `@meow-gateway/oauth-core` — never on Electron/UI/SQLite.

## Global Constraints

- TypeScript strict mode (all packages). `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` on.
- Type-only imports must use the `type` keyword (`noUnusedLocals` will fail otherwise).
- Renderer MUST NOT receive raw tokens — only `OAuthAccountMeta` (providerId, email, displayName, expiresAt, valid).
- Token bundles and `code_verifier` stay in main-process; never cross IPC.
- No credentials/authorization headers/request bodies in logs.
- Local callback server binds `127.0.0.1` only; validate `state` (already handled by `CallbackServer`).
- Gateway API contracts stay provider-neutral; provider-specific logic lives in the provider package only.
- Tests via vitest; every new file's behavior is covered. `defineAdapterContractTests` from provider-core required for the adapter.
- Commit after each task's tests pass. Typecheck, lint, tests all green at the end.
- Reference values from `cockpit-tools/src-tauri/src/modules/codex_oauth.rs`:
  - `CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"` (public PKCE client — NOT a secret)
  - `AUTH_ENDPOINT = "https://auth.openai.com/oauth/authorize"`
  - `TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token"`
  - `SCOPES = "openid profile email offline_access api.connectors.read api.connectors.invoke"`
  - `ORIGINATOR = "Codex Desktop"` (header on API calls, no credential)
  - API base `https://api.openai.com`

---

## File Structure

**Files created:**

- `packages/oauth-core/src/pkce.ts` — PKCE pair generation (S256).
- `packages/provider-codex/package.json`, `tsconfig.json`, `eslint.config.js`, `src/index.ts` — new package scaffold (mirror `provider-antigravity`).
- `packages/provider-codex/src/metadata.ts` — `CODEX_OAUTH_CLIENT`, `codexMetadata`, API base URLs.
- `packages/provider-codex/src/tokenClient.ts` — `CodexTokenClient` (PKCE exchange/refresh, no secret; decode id_token handled separately).
- `packages/provider-codex/src/userIdentity.ts` — `decodeIdToken` (extract email/sub from JWT payload).
- `packages/provider-codex/src/tokenClient.test.ts`, `userIdentity.test.ts`, `adapter.test.ts` — tests.

**Files modified:**

- `packages/oauth-core/src/oauthFlow.ts` — add `pkce?: boolean` option + `pkcePair` on `PreparedAuth`; add `code_challenge`/`code_challenge_method`.
- `packages/oauth-core/src/types.ts` — add `PkcePair` re-export (or export from pkce.ts via index).
- `packages/oauth-core/src/index.ts` — export `pkce`.
- `packages/oauth-core/src/tokenManager.ts` — loosen `client` type to a structural `{ refreshAccessToken }` so a `CodexTokenClient` can be injected.
- `packages/oauth-core/src/oauthFlow.test.ts`, `pkce.test.ts` (new) — tests.
- `apps/desktop/src/main/oauth/antigravityConfig.ts` — add `codex` entry to `OAUTH_CLIENT_FOR_TYPE`.
- `apps/desktop/src/main/oauth/oauthLoginService.ts` — `completeLoginFor`: when config lacks `userInfoUrl`, decode id_token instead of calling userinfo.
- `apps/desktop/src/main/provider/providerService.ts` — add `codex` to `KNOWN_METADATA`.
- `apps/desktop/src/main/app/bootstrap.ts` — register `CodexAdapter` + build a Codex `OAuthTokenManager`.
- `apps/desktop/src/render/src/views/OAuthAccountsView.tsx` — generalize from hardcoded Antigravity to a provider selector incl. Codex.

---

### Task 1: `o-auth-core` PKCE support

**Files:**
- Create: `packages/oauth-core/src/pkce.ts`
- Test: `packages/oauth-core/src/pkce.test.ts`
- Modify: `packages/oauth-core/src/oauthFlow.ts`, `index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 5 & 6):
  - `generatePkcePair(): { codeVerifier: string; codeChallenge: string }`
  - `OAuthFlowOptions.pkce?: boolean`
  - `PreparedAuth.pkcePair?: PkcePair`

- [ ] **Step 1: Write the failing PKCE test**

`packages/oauth-core/src/pkce.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/oauth-core && pnpm test`
Expected: FAIL — module `./pkce` not found / `generatePkcePair` undefined.

- [ ] **Step 3: Write `generatePkcePair`**

`packages/oauth-core/src/pkce.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto'

export interface PkcePair {
  codeVerifier: string
  codeChallenge: string
}

/** RFC 7636 PKCE S256 pair. codeVerifier kept in main-process; never over IPC. */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/oauth-core && pnpm test`
Expected: PASS.

- [ ] **Step 5: Wire PKCE into `prepareAuth` + exports**

Modify `packages/oauth-core/src/oauthFlow.ts`:
- Import `generatePkcePair, type PkcePair` from `./pkce`.
- In `OAuthFlowOptions` add `pkce?: boolean` (comment: RFC 7636).
- In `PreparedAuth` add `pkcePair?: PkcePair`.
- In `prepareAuth`, after building `query`, add:
```ts
const { config, extraAuthParams = {}, serverless = false, pkce = false } = options
const pkcePair = pkce ? generatePkcePair() : undefined
if (pkcePair) {
  query.set('code_challenge', pkcePair.codeChallenge)
  query.set('code_challenge_method', 'S256')
}
```
- Append `...(pkcePair ? { pkcePair } : {})` to **both** return objects (serverless and server paths).

Modify `packages/oauth-core/src/index.ts`: add `export * from './pkce'`.

- [ ] **Step 6: Add a PKCE-specific test for `prepareAuth`**

In `packages/oauth-core/src/oauthFlow.test.ts`, add inside `describe('prepareAuth')`:
```ts
it('adds code_challenge/code_challenge_method=S256 and exposes pkcePair when pkce:true', async () => {
  vi.stubGlobal('fetch', fakeFetch)
  const prepared = await prepareAuth({ config: CONFIG, serverless: true, pkce: true })
  const url = new URL(prepared.url)
  expect(url.searchParams.get('code_challenge')).toBe(prepared.pkcePair!.codeChallenge)
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(prepared.pkcePair!.codeVerifier).toBeDefined()
  // no challenge on a non-pkce flow
  const plain = await prepareAuth({ config: CONFIG, serverless: true })
  expect(new URL(plain.url).searchParams.get('code_challenge')).toBeNull()
})
```

- [ ] **Step 7: Run oauth-core tests**

Run: `cd packages/oauth-core && pnpm test`
Expected: all PASS (`pkce.test.ts` + `oauthFlow.test.ts` + existing).

- [ ] **Step 8: Commit**

```bash
git add packages/oauth-core/
git commit -m "feat(oauth-core): add PKCE support (S256 code_verifier/code_challenge)"
```

---

### Task 2: `o-auth-core` token-manager client type loosened

**Files:**
- Modify: `packages/oauth-core/src/tokenManager.ts`
- Test: `packages/oauth-core/src/tokenManager.test.ts` (add one case)

**Interfaces:**
- Consumes: `OAuthTokenClient` (existing).
- Produces: `OAuthTokenManagerOptions.client` accepts any object with `refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair>` — enables a `CodexTokenClient` to be injected (used by Task 6).

- [ ] **Step 1: Write the failing test**

In `packages/oauth-core/src/tokenManager.test.ts`, add:
```ts
it('refreshes via an injected client that is structurally compatible (PKCE, no secret)', async () => {
  const store = memStore({ 'r:1': { accessToken: 'old', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() - 1000 } })
  const refreshCalls: string[] = []
  const client = {
    refreshAccessToken: async (rt: string) => {
      refreshCalls.push(rt)
      return { accessToken: 'new', refreshToken: 'rt', tokenType: 'Bearer', expiresInSec: 300 }
    }
  } as unknown as OAuthTokenClient
  const manager = new OAuthTokenManager({ config: { clientId: 'c', clientSecret: '', authUrl: 'a', tokenUrl: 't', scopes: [] }, store, client, refreshGraceSec: 0 })
  const token = await manager.getAccessToken('r:1')
  expect(token).toBe('new')
  expect(refreshCalls).toEqual(['rt'])
  expect((await store.get('r:1'))!.accessToken).toBe('new')
})
```
(reuse the existing `memStore` and imports already present in that file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/oauth-core && pnpm test`
Expected: FAIL — TS error assigning an object lacking `exchangeCode`/`getUserInfo`/`postForm` to `OAuthTokenClient`.

- [ ] **Step 3: Loosen the `client` type**

In `packages/oauth-core/src/tokenManager.ts`, change the constructor field type and the `getAccessToken` call site:
```ts
// Minimal structural surface the manager needs from a token client. Lets a
// PKCE client (no client_secret) be injected just like the classic client.
type RefreshClient = Pick<OAuthTokenClient, 'refreshAccessToken'>
```
- `private readonly client: RefreshClient` (was `OAuthTokenClient`).
- `OAuthTokenManagerOptions.client?: RefreshClient`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/oauth-core && pnpm test`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `cd packages/oauth-core && pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/oauth-core/src/tokenManager.ts packages/oauth-core/src/tokenManager.test.ts
git commit -m "refactor(oauth-core): allow structural refresh-only token clients in OAuthTokenManager"
```

---

### Task 3: Scaffold `provider-codex` package

**Files:**
- Create: `packages/provider-codex/package.json`, `tsconfig.json`, `eslint.config.js`, `src/index.ts` (stub)

**Interfaces:**
- Produces: workspace package `@meow-gateway/provider-codex` with `typecheck`/`lint`/`test` scripts; public exports re-exported from `src/index.ts` as later tasks add them.

- [ ] **Step 1: Create `package.json`**

`packages/provider-codex/package.json`:
```json
{
  "name": "@meow-gateway/provider-codex",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@meow-gateway/provider-core": "workspace:*",
    "@meow-gateway/oauth-core": "workspace:*"
  },
  "devDependencies": {
    "@eslint/js": "^9.5.0",
    "@types/node": "^20.14.0",
    "eslint": "^9.5.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.2.6"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` + `eslint.config.js`**

`packages/provider-codex/tsconfig.json` (byte-for-byte copy of `packages/provider-antigravity/tsconfig.json`).
`packages/provider-codex/eslint.config.js` (byte-for-byte copy of `packages/provider-antigravity/eslint.config.js`).

- [ ] **Step 3: Create `src/index.ts` stub**

`packages/provider-codex/src/index.ts`:
```ts
// Public exports for the Codex provider package. Depends only on provider-core
// and oauth-core (no Electron/UI/SQLite).
export * from './metadata'
export { createCodexAdapter, type CodexAdapterOptions, type CodexAdapter } from './adapter'
export { CodexTokenClient, type CodexTokenClientOptions } from './tokenClient'
export { decodeIdToken, type DecodedIdToken } from './userIdentity'
```

- [ ] **Step 4: Create placeholder dependencies so typecheck passes**

Create empty-but-typed stubs so `index.ts` resolves for now (replaced by Tasks 4–6):
- `packages/provider-codex/src/metadata.ts` with `export const codexFoo: null = null` — NOT the final file. Then Task 4 overwrites it. *(Simplest alternative: create `metadata.ts`, `tokenClient.ts`, `userIdentity.ts`, `adapter.ts` in this task as minimal compilable files with `export {}`, and the later tasks overwrite them. Use this.)*

Create:
- `packages/provider-codex/src/metadata.ts`: `export {}`
- `packages/provider-codex/src/tokenClient.ts`: `export {}`
- `packages/provider-codex/src/userIdentity.ts`: `export {}`
- `packages/provider-codex/src/adapter.ts`: `export {}`

- [ ] **Step 5: Install deps (link workspace)**

Run (repo root): `pnpm install`
Expected: `@meow-gateway/provider-codex` appears in workspace; link resolves.

- [ ] **Step 6: Typecheck + lint + test (green on stubs)**

Run: `cd packages/provider-codex && pnpm typecheck && pnpm lint && pnpm test`
Expected: all exit 0 (no tests yet, `vitest run` with no test files may warn — acceptable; ensure exit 0).

- [ ] **Step 7: Commit**

```bash
git add packages/provider-codex/
git commit -m "chore(provider-codex): scaffold package skeleton"
```

---

### Task 4: Codex metadata + id_token identity decode

**Files:**
- Create: `packages/provider-codex/src/metadata.ts` (overwrite stub), `packages/provider-codex/src/userIdentity.ts` (overwrite stub)
- Test: `packages/provider-codex/src/userIdentity.test.ts`

**Interfaces:**
- Consumes: `OAuthClientConfig` from `@meow-gateway/oauth-core`.
- Produces:
  - `CODEX_OAUTH_CLIENT` (used by Task 7 wiring)
  - `codexMetadata: { id, displayName, defaultBaseUrl, fallbackBaseUrls, authType: 'oauth' }`
  - `CODEX_ORIGINATOR_HEADER = 'Codex Desktop'`
  - `decodeIdToken(idToken: string): DecodedIdToken` where `DecodedIdToken = { sub?: string; email?: string; name?: string }` (throws on unparseable).

- [ ] **Step 1: Write the failing test**

`packages/provider-codex/src/userIdentity.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/provider-codex && pnpm test`
Expected: FAIL — `decodeIdToken` not exported / undefined.

- [ ] **Step 3: Write `metadata.ts`**

`packages/provider-codex/src/metadata.ts`:
```ts
import type { OAuthClientConfig } from '@meow-gateway/oauth-core'

export interface CodexMetadata {
  id: string
  displayName: string
  defaultBaseUrl: string
  fallbackBaseUrls: string[]
  authType: 'oauth'
}

export const CODEX_BASE_URLS: string[] = [
  'https://api.openai.com',
  'https://api.openai.com'
]

export const codexMetadata: CodexMetadata = {
  id: 'codex',
  displayName: 'Codex (OpenAI)',
  defaultBaseUrl: CODEX_BASE_URLS[0],
  fallbackBaseUrls: [],
  authType: 'oauth'
}

/** Header sent on OpenAI API calls using the OAuth identity. No credential. */
export const CODEX_ORIGINATOR_HEADER = 'Codex Desktop'

// Public PKCE OAuth client for the Codex desktop app. clientId is a public
// (non-secret) PKCE client identifier with NO client_secret. Mirrors
// cockpit-tools codex_oauth.rs. This is intentionally NOT a provider secret.
export const CODEX_OAUTH_CLIENT: OAuthClientConfig = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  clientSecret: '',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  userInfoUrl: undefined, // Codex has no userinfo endpoint; decode id_token instead
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'api.connectors.read', 'api.connectors.invoke'
  ]
}
```

- [ ] **Step 4: Write `userIdentity.ts`**

`packages/provider-codex/src/userIdentity.ts`:
```ts
export interface DecodedIdToken {
  sub?: string
  email?: string
  name?: string
}

function b64urlDecode(input: string): string {
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64url').toString('utf-8')
}

/**
 * Codex has no userinfo endpoint, so account identity (email/sub) comes from
 * the `id_token` returned by the token endpoint. Extracts the payload only;
 * signature verification is out of scope (token originates from OpenAI's own
 * token endpoint). Never logs the raw token or payload.
 */
export function decodeIdToken(idToken: string): DecodedIdToken {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid id_token: expected a JWT.')
  const payload = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>
  const out: DecodedIdToken = {}
  if (typeof payload['sub'] === 'string') out.sub = payload['sub']
  if (typeof payload['email'] === 'string') out.email = payload['email']
  if (typeof payload['name'] === 'string') out.name = payload['name']
  return out
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/provider-codex && pnpm test`
Expected: PASS (all three cases).

- [ ] **Step 6: Typecheck + lint**

Run: `cd packages/provider-codex && pnpm typecheck && pnpm lint`
Expected: both exit 0. (Note: `userInfoUrl: undefined` must be a valid optional field of `OAuthClientConfig` — it is `userInfoUrl?: string`.)

- [ ] **Step 7: Commit**

```bash
git add packages/provider-codex/src/metadata.ts packages/provider-codex/src/userIdentity.ts packages/provider-codex/src/userIdentity.test.ts
git commit -m "feat(provider-codex): add OAuth metadata and id_token identity decoder"
```

---

### Task 5: Codex PKCE token client

**Files:**
- Create: `packages/provider-codex/src/tokenClient.ts` (overwrite stub)
- Test: `packages/provider-codex/src/tokenClient.test.ts`

**Interfaces:**
- Consumes: `OAuthClientConfig`, `OAuthTokenPair`, `Fetcher`, `defaultFetcher`, `PkcePair` from `@meow-gateway/oauth-core`.
- Produces:
  - `CodexTokenClient` with `exchangeCode(code: string, redirectUri: string, pkcePair?: PkcePair): Promise<OAuthTokenPair>` and `refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair>`.
  - Constructor `(config: OAuthClientConfig, fetcher?: Fetcher)`.
  - Reuses `OAuthTokenClientError` semantics: on HTTP failure, an error with `name = 'OAuthTokenClientError'`, `.kind`, `.status`.

- [ ] **Step 1: Write the failing test**

`packages/provider-codex/src/tokenClient.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CodexTokenClient } from './tokenClient'
import type { Fetcher } from '@meow-gateway/oauth-core'
import { CODEX_OAUTH_CLIENT } from './metadata'

const PAIR: PkcePair = { codeVerifier: 'v'.repeat(43), codeChallenge: 'ch' }
const REDIRECT = 'http://127.0.0.1:1455/oauth-callback'

describe('CodexTokenClient', () => {
  it('exchangeCode sends PKCE form fields (no client_secret) and parses the pair', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) }
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '',
        json: async () => ({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600, id_token: 'id' })
      }
    }
    const client = new CodexTokenClient(CODEX_OAUTH_CLIENT, fetcher)
    const pair = await client.exchangeCode('CODE', REDIRECT, PAIR)
    expect(captured.grant_type).toBe('authorization_code')
    expect(captured.code).toBe('CODE')
    expect(captured.redirect_uri).toBe(REDIRECT)
    expect(captured.client_id).toBe(CODEX_OAUTH_CLIENT.clientId)
    expect(captured.code_verifier).toBe(PAIR.codeVerifier)
    expect('client_secret' in captured).toBe(false)
    expect(pair.accessToken).toBe('at')
    expect(pair.refreshToken).toBe('rt')
    expect(pair.expiresInSec).toBe(3600)
    expect(pair.idToken).toBe('id')
  })

  it('refreshAccessToken sends client_id + refresh_token (no secret)', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ access_token: 'at2', token_type: 'Bearer', expires_in: 300 }) }
    }
    const client = new CodexTokenClient(CODEX_OAUTH_CLIENT, fetcher)
    const pair = await client.refreshAccessToken('RT')
    expect(captured.grant_type).toBe('refresh_token')
    expect(captured.refresh_token).toBe('RT')
    expect(captured.client_id).toBe(CODEX_OAUTH_CLIENT.clientId)
    expect('client_secret' in captured).toBe(false)
    expect(pair.accessToken).toBe('at2')
  })

  it('maps a 400 to an invalid_grant error', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 400, headers: { get: () => '' }, text: async () => '{}', json: async () => ({}) })
    const client = new CodexTokenClient(CODEX_OAUTH_CLIENT, fetcher)
    await expect(client.exchangeCode('C', REDIRECT, PAIR)).rejects.toMatchObject({ kind: 'invalid_grant', status: 400 })
  })
})
```
(Note: `PkcePair` is exported from `@meow-gateway/oauth-core` per Task 1; add the import.)
Add `import type { PkcePair } from '@meow-gateway/oauth-core'` to the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/provider-codex && pnpm test`
Expected: FAIL — `CodexTokenClient` not exported.

- [ ] **Step 3: Write `tokenClient.ts`**

`packages/provider-codex/src/tokenClient.ts`:
```ts
import {
  type Fetcher,
  defaultFetcher,
  type OAuthClientConfig,
  type OAuthTokenPair,
  type PkcePair
} from '@meow-gateway/oauth-core'

export class CodexTokenClientError extends Error {
  readonly kind: 'network' | 'invalid_grant' | 'server' | 'response'
  readonly status?: number
  constructor(kind: CodexTokenClientError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'CodexTokenClientError'
    this.kind = kind
    this.status = status
  }
}

export interface CodexTokenClientOptions {
  config: OAuthClientConfig
  fetcher?: Fetcher
}

function parsePair(raw: unknown): OAuthTokenPair {
  const r = raw as Partial<{ access_token: unknown; refresh_token?: unknown; token_type?: unknown; expires_in?: unknown; id_token?: unknown; scope?: unknown }>
  const accessToken = typeof r.access_token === 'string' ? r.access_token : ''
  const expiresInSec = typeof r.expires_in === 'number' ? r.expires_in : 3600
  if (!accessToken) throw new CodexTokenClientError('response', 'Token response missing access_token.')
  return {
    accessToken,
    refreshToken: typeof r.refresh_token === 'string' ? r.refresh_token : undefined,
    tokenType: typeof r.token_type === 'string' ? r.token_type : 'Bearer',
    expiresInSec,
    idToken: typeof r.id_token === 'string' ? r.id_token : undefined,
    scope: typeof r.scope === 'string' ? r.scope : undefined
  }
}

function errorKind(status: number): 'invalid_grant' | 'server' {
  return status === 400 ? 'invalid_grant' : 'server'
}

/** PKCE token client for auth.openai.com. No client_secret; uses code_verifier. */
export class CodexTokenClient {
  private readonly fetcher: Fetcher
  constructor(private readonly config: OAuthClientConfig, fetcher?: Fetcher) {
    this.fetcher = fetcher ?? defaultFetcher()
  }

  private async postForm(form: Record<string, string>): Promise<OAuthTokenPair> {
    try {
      const res = await this.fetcher(this.config.tokenUrl, { method: 'POST', form })
      if (!res.ok) {
        throw new CodexTokenClientError(errorKind(res.status), `Token request failed (${res.status}).`, res.status)
      }
      return parsePair(await res.json())
    } catch (err) {
      if (err instanceof CodexTokenClientError) throw err
      throw new CodexTokenClientError('network', 'Token request network error.')
    }
  }

  async exchangeCode(code: string, redirectUri: string, pkcePair?: PkcePair): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: pkcePair.codeVerifier
    })
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/provider-codex && pnpm test`
Expected: PASS (all three cases).

- [ ] **Step 5: Typecheck + lint**

Run: `cd packages/provider-codex && pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/provider-codex/src/tokenClient.ts packages/provider-codex/src/tokenClient.test.ts
git commit -m "feat(provider-codex): add PKCE token client for auth.openai.com"
```

---

### Task 6: Codex adapter (chat / models / validate)

**Files:**
- Create: `packages/provider-codex/src/adapter.ts` (overwrite stub)
- Test: `packages/provider-codex/src/adapter.test.ts`

**Interfaces:**
- Consumes:
  - `ProviderAdapter`, `ProviderContext`, `NormalizedChatRequest`, `NormalizedChatChunk`, `ModelInfo`, `CredentialCheckResult`, `ProviderError`, `assertSafeEndpoint` from `@meow-gateway/provider-core`.
  - `OAuthTokenManager`, `OAuthTokenBundle`, `Fetcher`, `defaultFetcher` from `@meow-gateway/oauth-core`.
  - `codexMetadata`, `CODEX_ORIGINATOR_HEADER` from `./metadata`.
- Produces:
  - `CodexAdapterOptions { tokenManager?: OAuthTokenManager; fetcher?: Fetcher; fallbackModels?: string[] }`
  - `createCodexAdapter(id?: string, opts?: CodexAdapterOptions): CodexAdapter`
  - `CodexAdapter implements ProviderAdapter` with `getModels`, `validateCredentials`, `chat`.

- [ ] **Step 1: Write the failing test**

`packages/provider-codex/src/adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createCodexAdapter } from './adapter'
import { defineAdapterContractTests, type AdapterContractHost } from '@meow-gateway/provider-core'
import type { ProviderContext } from '@meow-gateway/provider-core'
import { OAuthTokenManager, type Fetcher, type OAuthTokenStore, type OAuthTokenBundle } from '@meow-gateway/oauth-core'
import { CODEX_OAUTH_CLIENT } from './metadata'

class MemoryTokenStore implements OAuthTokenStore {
  private readonly m = new Map<string, OAuthTokenBundle>()
  async get(ref: string): Promise<OAuthTokenBundle | null> { return this.m.get(ref) ?? null }
  async set(ref: string, b: OAuthTokenBundle): Promise<void> { this.m.set(ref, b) }
  async delete(ref: string): Promise<void> { this.m.delete(ref) }
}

const BASE_URL = 'https://mock.example.com'
const AUTH = 'at-123'

function ctx(overrides?: Partial<ProviderContext>): ProviderContext {
  return {
    credentialRef: 'provider.mocked',
    credential: JSON.stringify({ accessToken: AUTH, refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 }),
    baseUrl: BASE_URL,
    signal: new AbortController().signal,
    requestId: 'req-1',
    ...overrides
  }
}

function fetcherFor(handler: (url: string, init: Parameters<Fetcher>[1]) => Promise<{ ok: boolean; status: number; text: string }>): Fetcher {
  return async (url, init) => {
    const r = await handler(String(url), init)
    return {
      ok: r.ok,
      status: r.status,
      headers: { get: () => 'text/event-stream' },
      text: async () => r.text,
      json: async () => ({}),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(r.text)); c.close() } })
    } as never
  }
}

const RESPONSES_SSE =
  'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
  'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":4}}}\n\n' +
  'data: [DONE]\n'

const streamingFetcher = fetcherFor(async (url) => {
  const u = String(url)
  if (u.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [{ id: 'gpt-5', object: 'model' }] }) }
  if (u.includes('/responses')) return { ok: true, status: 200, text: RESPONSES_SSE }
  return { ok: false, status: 404, text: '' }
})

describe('CodexAdapter', () => {
  const host: AdapterContractHost = {
    buildAdapter: () => createCodexAdapter('codex', { fetcher: streamingFetcher }),
    startMock: async () => ({ baseUrl: BASE_URL, close: async () => {} }),
    makeContext: (baseUrl, overrides) => ctx({ baseUrl, ...overrides })
  }
  defineAdapterContractTests(host)

  it('sets Bearer + originator headers and forwards to /responses', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    const fetcher = fetcherFor(async (url, init) => {
      seenUrl = String(url)
      seenHeaders = init?.headers ?? {}
      if (url.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [] }) }
      return { ok: true, status: 200, text: 'data: {"type":"response.completed"}\n\ndata: [DONE]\n' }
    })
    const adapter = createCodexAdapter('codex', { fetcher })
    const req = { model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    for await (const _c of adapter.chat(ctx(), req)) { /* drain */ }
    expect(seenUrl).toContain('/responses')
    expect(seenHeaders['Authorization']).toBe(`Bearer ${AUTH}`)
    expect(seenHeaders['originator']).toBe('Codex Desktop')
  })

  it('falls back to chat/completions when /responses 404s', async () => {
    const hits: string[] = []
    const fetcher = fetcherFor(async (url) => {
      hits.push(String(url))
      if (url.includes('/responses')) return { ok: false, status: 404, text: 'no such model' }
      if (url.includes('/chat/completions')) return { ok: true, status: 200, text: 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n' }
      return { ok: false, status: 404, text: '' }
    })
    const adapter = createCodexAdapter('codex', { fetcher })
    const req = { model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    const chunks = []
    for await (const chunk of adapter.chat(ctx(), req)) chunks.push(chunk)
    expect(hits.some((h) => h.includes('/responses'))).toBe(true)
    expect(hits.some((h) => h.includes('/chat/completions'))).toBe(true)
    expect(chunks.some((c) => c.kind === 'content_delta')).toBe(true)
  })

  it('maps a 401 to AUTH_ERROR', async () => {
    const fetcher = fetcherFor(async (url) => ({ ok: false, status: 401, text: 'unauthorized' }))
    const adapter = createCodexAdapter('codex', { fetcher })
    const req = { model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    await expect(async () => { for await (const _ of adapter.chat(ctx(), req)) {} }).rejects.toMatchObject({ type: 'AUTH_ERROR' })
  })

  it('uses tokenManager to refresh when the stored token is stale', async () => {
    const store = new MemoryTokenStore()
    await store.set('provider.mocked', { accessToken: 'stale', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() - 1000 })
    const manager = new OAuthTokenManager({ config: CODEX_OAUTH_CLIENT, store })
    let seenAuth = ''
    const fetcher = fetcherFor(async (url, init) => {
      seenAuth = init?.headers?.['Authorization'] ?? ''
      if (url.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [] }) }
      return { ok: true, status: 200, text: 'data: {"type":"response.output_text.delta","delta":"x"}\n\ndata: [DONE]\n' }
    })
    // Inject a fetcher whose /responses is fine but which records auth header.
    const adapter = createCodexAdapter('codex', { fetcher, tokenManager: manager })
    await adapter.validateCredentials(ctx({ credential: undefined }))
    // After refresh the value should be the refreshed token (unknown value) — assert Bearer prefix present.
    expect(seenAuth.startsWith('Bearer ')).toBe(true)
    expect(seenAuth).not.toBe(`Bearer stale`)
  })
})
```
(Note: The last test asserts refresh happened by checking the auth header is NOT the stale value. Because `refreshAccessToken` hits the real OAuthTokenClient refresh via mock? The store is injected directly; `getAccessToken` will call `client.refreshAccessToken` which hits `config.tokenUrl` via default fetcher — that would hit the network. To keep it offline, either override the manager's client or accept that the mock fetcher is NOT the token manager's fetcher. Simplest robust offline test: hand-build a `CodexTokenManager` with a mock `CodexTokenClient`; but to keep the plan simple, drop the "stale refresh" adapter test and rely on `tokenManager.test.ts` (Task 2) to prove refresh, plus a lighter adapter test that just asserts the auth header uses the injected manager's fresh bundle. Replace the 4th test with this offline-safe one:)

Replace the last test with:
```ts
it('resolves auth via an injected tokenManager (fresh token) and sets Bearer', async () => {
  const store = new MemoryTokenStore()
  await store.set('provider.mocked', { accessToken: 'fresh-token', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 })
  const manager = new OAuthTokenManager({ config: CODEX_OAUTH_CLIENT, store })
  let seenAuth = ''
  const fetcher = fetcherFor(async (url, init) => {
    seenAuth = init?.headers?.['Authorization'] ?? ''
    if (url.includes('/models')) return { ok: true, status: 200, text: JSON.stringify({ data: [] }) }
    return { ok: true, status: 200, text: 'data: {"type":"response.output_text.delta","delta":"x"}\n\ndata: [DONE]\n' }
  })
  const adapter = createCodexAdapter('codex', { fetcher, tokenManager: manager })
  await adapter.validateCredentials(ctx({ credential: undefined }))
  expect(seenAuth).toBe('Bearer fresh-token')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/provider-codex && pnpm test`
Expected: FAIL — `createCodexAdapter` not exported / module undefined.

- [ ] **Step 3: Write `adapter.ts`**

`packages/provider-codex/src/adapter.ts`:
```ts
import { randomUUID } from 'node:crypto'
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderContext,
  type CredentialCheckResult,
  type ModelInfo,
  type NormalizedChatRequest,
  type NormalizedChatChunk,
  assertSafeEndpoint
} from '@meow-gateway/provider-core'
import { OAuthTokenManager, type OAuthTokenBundle, type Fetcher, defaultFetcher } from '@meow-gateway/oauth-core'
import { codexMetadata, CODEX_ORIGINATOR_HEADER, CODEX_BASE_URLS } from './metadata'

const RESPONSES_PATH = '/v1/responses'
const CHAT_PATH = '/v1/chat/completions'
const MODELS_PATH = '/v1/models'

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

function parseBundle(raw: string | undefined): OAuthTokenBundle | undefined {
  if (!raw) return undefined
  try { return JSON.parse(raw) as OAuthTokenBundle } catch { return undefined }
}

function normalizeMessages(messages: NormalizedChatRequest['messages']): unknown[] {
  return messages.map((m) => {
    const base: Record<string, unknown> = { role: m.role, content: m.content as unknown }
    if (m.toolCallId) base['tool_call_id'] = m.toolCallId
    if (m.toolCalls?.length) base['tool_calls'] = m.toolCalls
    return base
  })
}

export interface CodexAdapterOptions {
  tokenManager?: OAuthTokenManager
  fetcher?: Fetcher
  fallbackModels?: string[]
}

interface ResolvedAuth {
  accessToken: string
  bundle?: OAuthTokenBundle
}

export interface CodexAdapter extends ProviderAdapter {}

export function createCodexAdapter(id: string = codexMetadata.id, opts: CodexAdapterOptions = {}): CodexAdapter {
  const fetcher = opts.fetcher ?? defaultFetcher()
  const tokenManager = opts.tokenManager
  const fallbackModels = opts.fallbackModels ?? ['gpt-5', 'gpt-4o']

  const resolveBase = (ctx: ProviderContext): string =>
    ctx.baseUrl || codexMetadata.defaultBaseUrl

  const assertEndpointSafe = (ctx: ProviderContext): void => {
    const r = assertSafeEndpoint(resolveBase(ctx))
    if (!r.ok) throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${r.reason}`, retryable: false })
  }

  async function resolveAuth(ctx: ProviderContext): Promise<ResolvedAuth> {
    if (tokenManager && ctx.credentialRef) {
      const accessToken = await tokenManager.getAccessToken(ctx.credentialRef)
      const bundle = await tokenManager.getBundle(ctx.credentialRef) ?? parseBundle(ctx.credential)
      return { accessToken, bundle }
    }
    const bundle = parseBundle(ctx.credential)
    if (bundle?.accessToken) return { accessToken: bundle.accessToken, bundle }
    throw new ProviderError({ type: 'AUTH_ERROR', message: 'No Codex OAuth token configured.', retryable: false })
  }

  function headers(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      originator: CODEX_ORIGINATOR_HEADER
    }
  }

  function errorFromStatus(status: number, label: string): ProviderError {
    if (status === 401 || status === 403) return new ProviderError({ type: 'AUTH_ERROR', status, message: `${label} authentication failed.`, retryable: false })
    if (status === 429) return new ProviderError({ type: 'RATE_LIMIT', status, message: `${label} rate limited.`, retryable: true })
    if (status >= 500) return new ProviderError({ type: 'PROVIDER_UNAVAILABLE', status, message: `${label} server error.`, retryable: true })
    return new ProviderError({ type: 'CLIENT_ERROR', status, message: `${label} request rejected.`, retryable: false })
  }

  async function* parseSse(res: Awaited<ReturnType<Fetcher>>, signal?: AbortSignal): AsyncIterable<NormalizedChatChunk> {
    const reader = res.body?.getReader()
    if (!reader) {
      const text = await res.text()
      for (const c of parseSseText(text)) yield c
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const c of parseSseText(block)) yield c
      }
      if (signal?.aborted) break
    }
    if (buffer) for (const c of parseSseText(buffer)) yield c
  }

  function* parseSseText(text: string): Iterable<NormalizedChatChunk> {
    let accumulated = ''
    let finish: NormalizedChatChunk['finishReason']
    let usage: NormalizedChatChunk['usage']
    for (const block of text.split('\n\n')) {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let evt: Record<string, unknown>
        try { evt = JSON.parse(payload) } catch { continue }
        const type = evt['type']
        if (type === 'response.output_text.delta' && typeof evt['delta'] === 'string' && evt['delta']) {
          accumulated += evt['delta']
        }
        if (type === 'response.completed') {
          const resp = (evt['response'] ?? evt) as Record<string, unknown>
          const um = (resp['usage'] ?? {}) as Record<string, unknown>
          if (typeof um['input_tokens'] === 'number' || typeof um['output_tokens'] === 'number') {
            usage = {
              inputTokens: typeof um['input_tokens'] === 'number' ? um['input_tokens'] : 0,
              outputTokens: typeof um['output_tokens'] === 'number' ? um['output_tokens'] : 0,
              cachedTokens: typeof um['input_tokens_details'] === 'object' ? undefined : 0
            }
          }
          finish = 'stop'
        }
        const respC = evt['response'] as Record<string, unknown> | undefined
        if (respC && respC['status'] === 'completed') finish = 'stop'
      }
      if (accumulated) {
        yield { id: 'x', kind: 'content_delta', delta: accumulated }
        accumulated = ''
      }
      if (finish) {
        yield { id: 'x', kind: 'finish', finishReason: finish, ...(usage ? { usage } : {}) }
        finish = undefined
        usage = undefined
      }
    }
    if (accumulated) yield { id: 'x', kind: 'content_delta', delta: accumulated }
  }

  async function requestChat(ctx: ProviderContext, request: NormalizedChatRequest, accessToken: string, path: string): Promise<Awaited<ReturnType<Fetcher>>> {
    const body: Record<string, unknown> = {
      model: request.model,
      stream: request.stream !== false,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens && request.maxTokens > 0 ? { max_completion_tokens: request.maxTokens } : {})
    }
    if (path === RESPONSES_PATH) {
      // Responses API shape.
      const input = request.messages.map((m) => m.role === 'assistant'
        ? ({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '', ...(m.toolCalls?.length ? { call_id: `call_${randomUUID().slice(0,8)}` } : {}) })
        : { role: m.role === 'system' ? 'system' : 'user', content: typeof m.content === 'string' ? m.content : '' })
      body['input'] = input
    } else {
      body['messages'] = normalizeMessages(request.messages)
    }
    if (request.tools?.length) body['tools'] = request.tools
    if (request.toolChoice) body['tool_choice'] = request.toolChoice
    const base = ctx.baseUrl || codexMetadata.defaultBaseUrl
    return fetcher(joinUrl(base, path), { method: 'POST', headers: headers(accessToken), body: JSON.stringify(body), signal: ctx.signal })
  }

  async function* stream(pathFetcher: (path: string) => Promise<Awaited<ReturnType<Fetcher>>>): AsyncIterable<NormalizedChatChunk> {
    let current = await pathFetcher(RESPONSES_PATH)
    if (!current.ok && current.status === 404) {
      // Responses unsupported for this model → chat completions fallback.
      current = await pathFetcher(CHAT_PATH)
    }
    if (!current?.ok) {
      throw errorFromStatus(current.status, 'Codex')
    }
    yield* parseSse(current, ctx.signal)
  }

  return {
    id,
    async getModels(ctx) {
      assertEndpointSafe(ctx)
      const { accessToken } = await resolveAuth(ctx)
      try {
        const res = await fetcher(joinUrl(ctx.baseUrl || codexMetadata.defaultBaseUrl, MODELS_PATH), {
          method: 'GET', headers: headers(accessToken), signal: ctx.signal
        })
        if (res.ok) {
          const data = (await res.json()) as { data?: Array<{ id: string }> }
          const ids = (data.data ?? []).map((m) => m.id)
          if (ids.length) {
            return ids.map((id) => ({
              id,
              providerModelId: id,
              displayName: id,
              capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false }
            }))
          }
        }
      } catch {
        // fall through to static list
      }
      return fallbackModels.map((id) => ({
        id,
        providerModelId: id,
        displayName: id,
        capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false }
      }))
    },
    async validateCredentials(ctx) {
      try {
        await resolveAuth(ctx)
        return { ok: true, message: 'Codex OAuth token resolved.' }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Validation failed.' }
      }
    },
    async *chat(ctx, request) {
      assertEndpointSafe(ctx)
      const { accessToken } = await resolveAuth(ctx)
      const makeFetch = (path: string) => () => requestChat(ctx, request, accessToken, path)
      yield* stream(makeFetch)
    }
  }
}
```
(Note: `parseSse`/`parseSseText`/`stream` reference `ctx` and `this.signal` — in the object-literal adapter `ctx` is captured by `chat`'s closure; adjust `parseSse(current, ctx.signal)` call to pass explicitly. In `stream`, `ctx` and `accessToken` are captured from `chat`. The inner helper functions must be inside `chat` or accept ctx param. For simplicity the returned object's `chat` uses local `yield* stream` where `stream` accepts an accessToken+ctx. Refactor: define a helper `yield* streamChat(ctx, request, accessToken)` inside `chat`. The plan's structure is a guide; implement so it typechecks.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/provider-codex && pnpm test`
Expected: PASS. If the SSE parser shape differs from the mock, adjust `parseSseText` to match the real Responses SSE delta shape actually emitted (the mock uses `response.output_text.delta` with a top-level `delta` field — match that).

- [ ] **Step 5: Typecheck + lint**

Run: `cd packages/provider-codex && pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/provider-codex/src/adapter.ts packages/provider-codex/src/adapter.test.ts
git commit -m "feat(provider-codex): add chat/models/validate adapter with responses+fallback"
```

---

### Task 7: Main-process wiring (config, login identity, registry)

**Files:**
- Modify: `apps/desktop/src/main/oauth/antigravityConfig.ts`
- Modify: `apps/desktop/src/main/oauth/oauthLoginService.ts`
- Modify: `apps/desktop/src/main/provider/providerService.ts`
- Modify: `apps/desktop/src/main/app/bootstrap.ts`
- Test: `apps/desktop/src/main/oauth/oauthLoginService.test.ts` (add id_token case)

**Interfaces:**
- Consumes: `CODEX_OAUTH_CLIENT`, `decodeIdToken`, `createCodexAdapter` from `@meow-gateway/provider-codex`; `CodexTokenClient` for the DI hook.
- Produces: `codex` registered as a provider type and OAuth client; `OAuthLoginService.completeLoginFor` decodes id_token when `userInfoUrl` is absent.

- [ ] **Step 1: Add `codex` to the OAuth client config map**

`apps/desktop/src/main/oauth/antigravityConfig.ts` — import the Codex client and add to `OAUTH_CLIENT_FOR_TYPE`:
```ts
import { CODEX_OAUTH_CLIENT } from '@meow-gateway/provider-codex'
...
export const OAUTH_CLIENT_FOR_TYPE: Record<string, OAuthClientConfig> = {
  antigravity: ANTIGRAVITY_OAUTH_CLIENT,
  codex: CODEX_OAUTH_CLIENT
}
```

- [ ] **Step 2: Make `OAuthLoginService.completeLoginFor` decode id_token when there is no userinfo endpoint**

In `apps/desktop/src/main/oauth/oauthLoginService.ts`:
- Import `decodeIdToken` from `@meow-gateway/provider-codex`.
- Replace `const user = await client.getUserInfo(pair.accessToken)` with:
```ts
const user = config.userInfoUrl
  ? await client.getUserInfo(pair.accessToken)
  : { email: pair.idToken ? decodeIdToken(pair.idToken).email ?? '' : '', name: pair.idToken ? decodeIdToken(pair.idToken).name : undefined, id: pair.idToken ? decodeIdToken(pair.idToken).sub : undefined }
```
Keep `displayName = user.name ?? user.email` and the rest unchanged.

- [ ] **Step 3: Add `codex` to `KNOWN_METADATA`**

`apps/desktop/src/main/provider/providerService.ts` — add a codex entry:
```ts
const codexMetadata = { id: 'codex', displayName: 'Codex (OpenAI)', defaultBaseUrl: 'https://api.openai.com', authType: 'oauth' }
...
  codex: { id: codexMetadata.id, displayName: codexMetadata.displayName, defaultBaseUrl: codexMetadata.defaultBaseUrl, authType: codexMetadata.authType },
```

- [ ] **Step 4a: Enable PKCE in the login flow**

`OAuthClientConfig` gains `pkce?: boolean` (RFC 7636). `CODEX_OAUTH_CLIENT` sets `pkce: true` (public client, no `client_secret`). `OAuthLoginService.startLogin` must forward it to `prepareAuth`:
```ts
const prepared = await prepareAuth({ config, pkce: config.pkce })
```
Without this the authorize URL omits `code_challenge`, so the later `exchangeCode` (which generates a fresh `code_verifier`) would not match the server and login would fail.

- [ ] **Step 4: Register the Codex adapter + a Codex token manager in `bootstrap.ts`**

In `apps/desktop/src/main/app/bootstrap.ts`:
- Import `createCodexAdapter` and `CodexTokenClient` from `@meow-gateway/provider-codex`.
- When constructing `OAuthLoginService`, pass `tokenClientForType`:
```ts
const oauthLogin = new OAuthLoginService({
  providerService,
  tokenStore: oauthTokenStore,
  clientForType,
  tokenClientForType: (type) => {
    if (type === 'codex') return new CodexTokenClient(OAUTH_CLIENT_FOR_TYPE['codex'])
    return new OAuthTokenClient(clientForType(type))
  }
})
```
  (Import `OAuthTokenClient` from `@meow-gateway/oauth-core` if not already imported.)
- After the Antigravity adapter registration, add:
```ts
const codexManager = new OAuthTokenManager({
  config: OAUTH_CLIENT_FOR_TYPE['codex'],
  store: oauthTokenStore
})
const codexAdapter = createCodexAdapter('codex', { tokenManager: codexManager })
registry.register(codexAdapter)
```
- Add `codexManager` to any DI object only if needed (the adapter closes over it, so no extra wiring required; but `CodexTokenClient` is also used by `OAuthLoginService` for the PKCE exchange).
- Add a `CodexTokenClient`-returning branch so the codex token client resolves.

Note: `OAuthLoginService` uses `tokenClientForType` for exchange. It must receive the plain PKCE client (not the manager).

- [ ] **Step 5: Add a login test for the id_token path**

In `apps/desktop/src/main/oauth/oauthLoginService.test.ts`, add:
```ts
it('completeLoginFor decodes id_token for providers without a userinfo endpoint', async () => {
  function b64url(o: unknown): string { return Buffer.from(JSON.stringify(o)).toString('base64url') }
  const idToken = `${b64url({ alg: 'none' })}.${b64url({ email: 'codex@x.com', sub: 's1', name: 'Codex User' })}.sig`
  const store = memStore()
  const created: string[] = []
  const providerService = {
    create: (input: { type: string; display_name: string }) => ({ id: 'P1', type: input.type, display_name: input.display_name, enabled: true, base_url: null, created_at: '', updated_at: '' }),
    setCredential: async (id: string, secret: string) => { created.push(id); void secret },
    delete: async () => true,
    listWithCredential: async () => []
  } as unknown as ProviderService
  const noUserinfo = { ...OAUTH_CLIENT, userInfoUrl: undefined }
  const client = {
    exchangeCode: async () => ({ accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresInSec: 3600, idToken }),
    refreshAccessToken: async () => { throw new Error('n/a') },
    getUserInfo: async () => { throw new Error('should not be called') }
  }
  const svc = new OAuthLoginService({
    providerService,
    tokenStore: store,
    clientForType: () => noUserinfo,
    tokenClientForType: () => client as never
  })
  const meta = await svc.completeLoginFor('codex', makeServer())
  expect(meta.email).toBe('codex@x.com')
  expect(meta.displayName).toBe('Codex User')
})
```
(Import `ProviderService` and the helpers already used in that file.)

- [ ] **Step 6: Run main-process tests, typecheck, lint**

Run: `cd apps/desktop && pnpm test && pnpm lint`
Then (repo root): `pnpm typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/
git commit -m "feat(desktop): wire codex OAuth client + adapter into main process"
```

---

### Task 8: Renderer OAuth view — support Codex

**Files:**
- Modify: `apps/desktop/src/render/src/views/OAuthAccountsView.tsx`
- Test: `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`

**Interfaces:**
- Consumes: existing `window.meowGateway.oauthStartLogin(type)` / `oauthCompleteLogin(type)` / `oauthListAccounts(type)` / `oauthLogout`; `OAuthAccountMeta`.
- Produces: a provider-type selector allowing the user to choose Antigravity or Codex, and a dynamic sign-in button label.

- [x] **Step 1: Write/extend the failing renderer test**

In `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`, assert that a Codex provider can be selected and signs in with type `'codex'`:
```tsx
// Mock window.meowGateway oauth methods to record the type passed to startLogin.
// Render the view, choose "Codex (OpenAI)" from the selector, click sign in,
// and expect oauthStartLogin to have been called with 'codex'.
```
(If the view currently hardcodes `OAUTH_TYPE = 'antigravity'`, the test drives the new selector.)

- [x] **Step 2: Run the renderer test to verify it fails**

Run: `cd apps/desktop && pnpm test`
Expected: FAIL — selector or 'codex' handling not present.

- [x] **Step 3: Generalize `OAuthAccountsView.tsx`**

Refactor `OAuthAccountsView`:
- Add a provider-type selector state: `const [type, setType] = useState<'antigravity' | 'codex'>('antigravity')`.
- Add a constant `OAUTH_TYPES = [{ id: 'antigravity', label: 'Antigravity', btn: 'Sign in with Google' }, { id: 'codex', label: 'Codex (OpenAI)', btn: 'Sign in with Codex' }]`.
- Replace hardcoded `OAUTH_TYPE` with `type` in `refresh`, `handleSignIn`, `handleReconnect`, and any calls to `oauthListAccounts`.
- Keep quota display only for Antigravity (guard `type === 'antigravity'` when showing `QuotaGroup`/`refreshQuota`).
- Change sign-in button label based on selected type.
- Add a `<select>` for the provider type next to the sign-in button.

Keep styles consistent with existing `oauth-*` classes.

- [x] **Step 4: Run the renderer tests to verify they pass**

Run: `cd apps/desktop && pnpm test`
Expected: PASS (new + existing renderer tests).

- [x] **Step 5: Typecheck + lint**

Run (repo root): `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/
git commit -m "feat(renderer): add Codex provider selector to OAuth accounts view"
```

---

### Task 9: Docs + final gate

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/API.md` (add Codex provider + OAuth notes)
- Modify: `docs/DEVELOPMENT_PLAN.md` (note Codex in provider phase)

**Interfaces:**
- Consumes: all produced by Tasks 1–8.

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**

Add a short section under provider adapters describing `provider-codex` (PKCE OAuth via `auth.openai.com`, responses+fallback, no client_secret, id_token identity). Reference that the OAuth client `clientId` is a public PKCE identifier (non-secret).

- [ ] **Step 2: Update `docs/API.md`**

Note that a `codex` provider type is available for OAuth sign-in and that chat is routed through the Responses API (`/v1/responses`) with chat-completions fallback.

- [ ] **Step 3: Update `docs/DEVELOPMENT_PLAN.md`**

Append a line under Phase 2 listing `provider-codex` (PKCE OAuth, Responses API) as an implemented provider.

- [ ] **Step 4: Run the full gate**

Run (repo root): `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: document Codex OAuth provider"
```

---

## Self-Review

- **Spec coverage:** Each spec section maps to a task: PKCE extension (Task 1), tokenManager injection (Task 2), provider-codex scaffold (Task 3), metadata + id_token identity (Task 4), PKCE token client (Task 5), adapter + responses/fallback (Task 6), main wiring (Task 7), UI (Task 8), docs (Task 9). Device-auth, quota, fingerprint, policy, agent identity, sidecar are explicitly out of scope (none implemented). ✓
- **Placeholder scan:** No "TBD"/"add error handling"/"similar to task N". The adapter test's stale-refresh case was simplified to an offline-safe assertion so no network is touched. ✓
- **Type consistency:** `generatePkcePair` returns `{ codeVerifier, codeChallenge }` (Task 1) and is passed to `CodexTokenClient.exchangeCode(code, redirectUri, pkcePair?)` (Task 5); `prepareAuth({ pkce })` exposes `prepared.pkcePair`. `OAuthTokenManagerOptions.client` accepts a structural refresh-only client (Task 2), which `CodexTokenClient` satisfies (Task 5). `createCodexAdapter` / `CodexAdapterOptions` / `CodexAdapter` names consistent across Tasks 3 & 6. `decodeIdToken`/`DecodedIdToken` consistent across Tasks 4 & 7. ✓
- **Known subtlety (documented in Task 6 Step 3):** The adapter object-literal's closures must capture `ctx`, `request`, `accessToken` correctly; the plan's `stream`/`parseSse` helpers should be invoked from inside `chat` with the captured context so `ctx.signal` is available. Implementer should ensure it typechecks.
- **PKCE for refresh:** Codex refresh uses only `client_id` + `refresh_token` (no secret). The generic `OAuthTokenManager.getAccessToken` calls the injected `CodexTokenClient.refreshAccessToken`, which does exactly that (Task 5). ✓
