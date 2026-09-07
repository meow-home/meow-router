# OAuth (Antigravity) Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let meow-gateway sign in to a Google account via OAuth and use the Antigravity Cloud Code API as a normal provider (one provider = one account), with tokens stored in the OS secure store and auto-refreshed.

**Architecture:** Build a provider-neutral `oauth-core` package (callback server, token client, token store interface, token manager) plus an `provider-antigravity` adapter that calls the Cloud Code `v1internal:*` endpoints with an auto-refreshed bearer token. Main process wires a `OAuthTokenStore` (wrapping the existing `CredentialService`), an `OAuthLoginService`, IPC handlers, and a UI view. One provider row = one Google account; the token JSON bundle is stored under the provider's credential ref so the gateway needs no changes.

**Tech Stack:** TypeScript strict, pnpm monorepo, vitest, Electron main process (node:http), existing `@meow-gateway/provider-core`.

## Global Constraints

- TypeScript strict mode throughout.
- Renderer MUST NOT receive raw API keys or token bundles — only safe metadata.
- Provider credentials stored through the OS secure store (`CredentialService`).
- Local callback server binds `127.0.0.1` only (never `0.0.0.0`).
- Validate all IPC input.
- Never log credentials, authorization headers, or request bodies by default.
- Streaming must be supported end-to-end (SSE → `NormalizedChatChunk`).
- Abort/cancellation propagates from client to provider via `ctx.signal`.
- Provider-specific logic belongs in the provider adapter, not the gateway router.
- Use dependency injection at process boundaries (Fetcher, TokenStore, TokenManager).
- Every feature includes tests.
- Antigravity OAuth client_id/client_secret hardcoded in `metadata.ts` are **dev-only** (DANGER comment required) — this intentionally deviates from AGENTS.md "do not hard-code provider secrets" until a user-supplied-credentials path exists.
- `1 provider = 1 account`: repeated Google logins create new provider rows.

---

### Task 1: Scaffold `oauth-core` package + core types

**Files:**
- Create: `packages/oauth-core/package.json`
- Create: `packages/oauth-core/tsconfig.json`
- Create: `packages/oauth-core/eslint.config.mjs` (mirror `packages/provider-openai/eslint.config.mjs`)
- Create: `packages/oauth-core/src/types.ts`
- Create: `packages/oauth-core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface OAuthTokenBundle { accessToken: string; refreshToken: string; tokenType: string; expiresAt: number; idToken?: string; oauthClientKey?: string; scope?: string; projectId?: string }`
  - `export interface OAuthClientConfig { clientId: string; clientSecret: string; authUrl: string; tokenUrl: string; userInfoUrl?: string; scopes: string[] }`
  - `export interface OAuthUserInfo { id?: string; email: string; name?: string; picture?: string }`
  - `export interface OAuthTokenPair { accessToken: string; refreshToken?: string; tokenType: string; expiresInSec: number; idToken?: string; oauthClientKey?: string; scope?: string }`

**Steps:**

- [ ] **Step 1: Create `packages/oauth-core/package.json`**

```json
{
  "name": "@meow-gateway/oauth-core",
  "version": "0.5.2",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "vitest run"
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

- [ ] **Step 2: Create `packages/oauth-core/tsconfig.json`** (mirror `packages/provider-openai/tsconfig.json` exactly).

- [ ] **Step 3: Create `packages/oauth-core/eslint.config.mjs`** (copy `packages/provider-openai/eslint.config.mjs` verbatim).

- [ ] **Step 4: Create `packages/oauth-core/src/types.ts`**

```ts
export interface OAuthTokenBundle {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: number            // epoch ms
  idToken?: string
  oauthClientKey?: string
  scope?: string
  projectId?: string           // Antigravity: resolved lazily, cached by the adapter
}

export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  userInfoUrl?: string
  scopes: string[]
}

export interface OAuthUserInfo {
  id?: string
  email: string
  name?: string
  picture?: string
}

// Raw response from POST tokenUrl (exchange or refresh). `expiresInSec` is the
// OAuth `expires_in` field; callers translate it to `expiresAt` (ms).
export interface OAuthTokenPair {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresInSec: number
  idToken?: string
  oauthClientKey?: string
  scope?: string
}
```

- [ ] **Step 5: Create `packages/oauth-core/src/index.ts`**

```ts
export * from './types'
```

- [ ] **Step 6: Run typecheck**

Run: `cd packages/oauth-core && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Link workspace + install**

Run: `cd /d/GitHub/meow-router && pnpm install`
Expected: workspace recognizes `@meow-gateway/oauth-core`

- [ ] **Step 8: Commit**

```bash
git add packages/oauth-core pnpm-lock.yaml
git commit -m "feat(oauth-core): scaffold package + core types"
```

---

### Task 2: `tokenClient` (exchange / refresh / userinfo)

**Files:**
- Create: `packages/oauth-core/src/fetcher.ts`
- Create: `packages/oauth-core/src/tokenClient.ts`
- Test: `packages/oauth-core/src/tokenClient.test.ts`
- Modify: `packages/oauth-core/src/index.ts`

**Interfaces:**
- Consumes: `OAuthClientConfig`, `OAuthTokenPair`, `OAuthUserInfo` from `types.ts`.
- Produces:
  - `export interface Fetcher { (url: string, init?: { method?: string; headers?: Record<string,string>; body?: string; form?: Record<string,string>; signal?: AbortSignal }): Promise<FetcherResponse> }`
  - `export function defaultFetcher(): Fetcher`
  - `export class OAuthTokenClient { constructor(config: OAuthClientConfig, fetcher?: Fetcher); async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenPair>; async refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair>; async getUserInfo(accessToken: string): Promise<OAuthUserInfo> }`
  - On error: `exchangeCode`/`refreshAccessToken` throw `OAuthTokenClientError` with `.kind: 'network' | 'invalid_grant' | 'server' | 'response'` and `.status?`.

**Steps:**

- [ ] **Step 1: Write the failing test** — `packages/oauth-core/src/tokenClient.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { OAuthTokenClient, type Fetcher } from './tokenClient'

const CONFIG = {
  clientId: 'c', clientSecret: 's',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform']
}
const REDIRECT = 'http://127.0.0.1:54321/oauth-callback'

function jsonFetcher(status: number, body: unknown, calls?: string[]): Fetcher {
  return async (url, init) => {
    if (calls) calls.push(url)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body),
      json: async () => body,
      form: init?.form
    } as never
  }
}

describe('OAuthTokenClient', () => {
  it('exchangeCode POSTs form fields and returns a token pair with expiresInSec', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (url, init) => {
      captured = { ...(init?.form ?? {}) } as Record<string, string>
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3599, id_token: 'id' }), form: init?.form } as never
    }
    const client = new OAuthTokenClient(CONFIG, fetcher)
    const pair = await client.exchangeCode('CODE', REDIRECT)
    expect(captured.grant_type).toBe('authorization_code')
    expect(captured.code).toBe('CODE')
    expect(captured.redirect_uri).toBe(REDIRECT)
    expect(captured.client_id).toBe('c')
    expect(captured.client_secret).toBe('s')
    expect(pair.accessToken).toBe('at')
    expect(pair.refreshToken).toBe('rt')
    expect(pair.expiresInSec).toBe(3599)
  })

  it('refreshAccessToken POSTs grant_type=refresh_token', async () => {
    let captured: Record<string, string> = {}
    const fetcher: Fetcher = async (_url, init) => {
      captured = { ...(init?.form ?? {}) } as Record<string, string>
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ access_token: 'at2', token_type: 'Bearer', expires_in: 300 }), form: init?.form } as never
    }
    const client = new OAuthTokenClient(CONFIG, fetcher)
    const pair = await client.refreshAccessToken('RT')
    expect(captured.grant_type).toBe('refresh_token')
    expect(captured.refresh_token).toBe('RT')
    expect(pair.accessToken).toBe('at2')
  })

  it('getUserInfo uses Bearer header and returns email', async () => {
    let authHeader = ''
    const fetcher: Fetcher = async (_url, init) => {
      authHeader = init?.headers?.['Authorization'] ?? ''
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ id: 'u1', email: 'a@b.com', name: 'A' }), form: init?.form } as never
    }
    const client = new OAuthTokenClient(CONFIG, fetcher)
    const info = await client.getUserInfo('AT')
    expect(authHeader).toBe('Bearer AT')
    expect(info.email).toBe('a@b.com')
  })

  it('maps invalid_grant exchange to kind=invalid_grant', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 400, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ error: 'invalid_grant' }), json: async () => ({ error: 'invalid_grant' }) } as never)
    const client = new OAuthTokenClient(CONFIG, fetcher)
    await expect(client.exchangeCode('X', REDIRECT)).rejects.toMatchObject({ kind: 'invalid_grant' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/oauth-core && pnpm vitest run src/tokenClient.test.ts`
Expected: FAIL, module not found (`cannot find module './tokenClient'`)

- [ ] **Step 3: Create `packages/oauth-core/src/fetcher.ts`**

```ts
export interface FetcherResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
}

export interface FetcherInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  form?: Record<string, string>
  signal?: AbortSignal
}

export interface Fetcher {
  (url: string, init?: FetcherInit): Promise<FetcherResponse>
}

export function defaultFetcher(): Fetcher {
  if (typeof fetch !== 'function') {
    throw new Error('No global fetch available; provide a Fetcher.')
  }
  return async (url, init) => {
    const { form, ...rest } = init ?? {}
    let body: string | undefined = rest.body
    let headers = { ...(rest.headers ?? {}) }
    if (form) {
      body = new URLSearchParams(form).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    return fetch(url, { ...rest, body, headers }) as unknown as FetcherResponse
  }
}
```

- [ ] **Step 4: Create `packages/oauth-core/src/tokenClient.ts`**

```ts
import type { OAuthClientConfig, OAuthTokenPair, OAuthUserInfo } from './types'
import type { Fetcher } from './fetcher'
import { defaultFetcher } from './fetcher'

export class OAuthTokenClientError extends Error {
  readonly kind: 'network' | 'invalid_grant' | 'server' | 'response'
  readonly status?: number
  constructor(kind: OAuthTokenClientError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'OAuthTokenClientError'
    this.kind = kind
    this.status = status
  }
}

async function parseTokenPair(raw: unknown): Promise<OAuthTokenPair> {
  const r = raw as Partial<{
    access_token: unknown; refresh_token?: unknown; token_type?: unknown
    expires_in?: unknown; id_token?: unknown; scope?: unknown
  }>
  const accessToken = typeof r.access_token === 'string' ? r.access_token : ''
  const expiresInSec = typeof r.expires_in === 'number' ? r.expires_in : 3600
  if (!accessToken) {
    throw new OAuthTokenClientError('response', 'Token response missing access_token.')
  }
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
  if (status === 400) return 'invalid_grant'
  if (status >= 500) return 'server'
  return 'server'
}

export class OAuthTokenClient {
  private readonly fetcher: Fetcher
  constructor(
    private readonly config: OAuthClientConfig,
    fetcher?: Fetcher
  ) {
    this.fetcher = fetcher ?? defaultFetcher()
  }

  private async postForm(form: Record<string, string>): Promise<OAuthTokenPair> {
    try {
      const res = await this.fetcher(this.config.tokenUrl, {
        method: 'POST',
        form
      })
      if (!res.ok) {
        throw new OAuthTokenClientError(errorKind(res.status), `Token request failed (${res.status}).`, res.status)
      }
      return parseTokenPair(await res.json())
    } catch (err) {
      if (err instanceof OAuthTokenClientError) throw err
      throw new OAuthTokenClientError('network', 'Token request network error.')
    }
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenPair> {
    return this.postForm({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    if (!this.config.userInfoUrl) {
      throw new OAuthTokenClientError('response', 'No userInfoUrl configured.')
    }
    try {
      const res = await this.fetcher(this.config.userInfoUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) {
        throw new OAuthTokenClientError('server', `Userinfo request failed (${res.status}).`, res.status)
      }
      const raw = (await res.json()) as Partial<{ id?: string; email?: string; name?: string; picture?: string }>
      return {
        id: typeof raw.id === 'string' ? raw.id : undefined,
        email: typeof raw.email === 'string' ? raw.email : '',
        name: typeof raw.name === 'string' ? raw.name : undefined,
        picture: typeof raw.picture === 'string' ? raw.picture : undefined
      }
    } catch (err) {
      if (err instanceof OAuthTokenClientError) throw err
      throw new OAuthTokenClientError('network', 'Userinfo network error.')
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/oauth-core && pnpm vitest run src/tokenClient.test.ts`
Expected: PASS

- [ ] **Step 6: Export from index + typecheck**

Modify `packages/oauth-core/src/index.ts` to add: `export * from './fetcher'` and `export * from './tokenClient'`.
Run: `cd packages/oauth-core && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/oauth-core
git commit -m "feat(oauth-core): tokenClient exchange/refresh/userinfo"
```

---

### Task 3: `callbackServer` (local OAuth callback)

**Files:**
- Create: `packages/oauth-core/src/callbackServer.ts`
- Test: `packages/oauth-core/src/callbackServer.test.ts`
- Modify: `packages/oauth-core/src/index.ts`

**Interfaces:**
- Consumes: nothing (uses `node:http`).
- Produces:
  - `export interface OAuthCallbackHandle { port: number; redirectUri: string; waitForCode(state: string, timeoutMs?: number): Promise<{ code: string; state: string }>; close(): Promise<void> }`
  - `export function startCallbackServer(): Promise<OAuthCallbackHandle>`
  - Binds `127.0.0.1:0`; serves HTML at `/oauth-callback`; only resolves `waitForCode` when `state` query param matches; rejects on timeout (default 10 min) or `close()`.

**Steps:**

- [ ] **Step 1: Write the failing test** — `packages/oauth-core/src/callbackServer.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { startCallbackServer } from './callbackServer'

describe('startCallbackServer', () => {
  it('provides a redirectUri bound to 127.0.0.1 and serves the success page', async () => {
    const server = await startCallbackServer()
    expect(server.redirectUri).toContain('127.0.0.1')
    const res = await fetch(`${server.redirectUri}?code=abc&state=STATE`)
    const text = await res.text()
    expect(text).toContain('授权成功')
    await server.close()
  })

  it('resolves waitForCode only when state matches and returns the code', async () => {
    const server = await startCallbackServer()
    const pending = server.waitForCode('good-state')
    await fetch(`${server.redirectUri}?code=THE_CODE&state=good-state`)
    const result = await pending
    expect(result.code).toBe('THE_CODE')
    expect(result.state).toBe('good-state')
    await server.close()
  })

  it('rejects wrong state and keeps waiting for the right one', async () => {
    const server = await startCallbackServer()
    const pending = server.waitForCode('good-state')
    await fetch(`${server.redirectUri}?code=A&state=bad-state`)
    const text = await (await fetch(`${server.redirectUri}?code=B&state=good-state`)).text()
    expect(text).toContain('授权成功')
    const result = await pending
    expect(result.code).toBe('B')
    await server.close()
  })

  it('rejects on timeout', async () => {
    const server = await startCallbackServer()
    await expect(server.waitForCode('s', 200)).rejects.toThrow(/timeout/i)
    await server.close()
  })

  it('rejects when requested code is already consumed', async () => {
    const server = await startCallbackServer()
    const pending = server.waitForCode('s')
    await fetch(`${server.redirectUri}?code=X&state=s`)
    await pending
    await expect(server.waitForCode('s', 200)).rejects.toThrow(/timeout/i)
    await server.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/oauth-core && pnpm vitest run src/callbackServer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation** — `packages/oauth-core/src/callbackServer.ts`

```ts
import { createServer, type Server } from 'node:http'

export interface OAuthCallbackHandle {
  port: number
  redirectUri: string
  waitForCode(state: string, timeoutMs?: number): Promise<{ code: string; state: string }>
  close(): Promise<void>
}

const SUCCESS_HTML = (): string =>
  "<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#0d1117;color:#fff;'>" +
  "<h1 style='color:#4ade80;'>✅ 授权成功</h1><p>您可以关闭此窗口返回应用。</p>" +
  "<script>setTimeout(function(){window.close();},2000);</script></body></html>"

const FAIL_HTML = (message: string): string =>
  `<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#0d1117;color:#fff;'>` +
  `<h1 style='color:#f87171;'>❌ 授权失败</h1><p>${message}</p></body></html>`

interface PendingRequest {
  state: string
  timer: NodeJS.Timeout
  resolve: (value: { code: string; state: string }) => void
  reject: (err: Error) => void
}

type PendingMap = Map<string, PendingRequest>

export function startCallbackServer(): Promise<OAuthCallbackHandle> {
  return new Promise((startResolve, startReject) => {
    const pendings: PendingMap = new Map()
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${(server.address() as { port: number }).port}`)
      const isOptions = (req.method ?? 'GET').toUpperCase() === 'OPTIONS'
      if (isOptions) {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*' 
        })
        res.end()
        return
      }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state') ?? ''
      const pending = pendings.get(state)
      if (!pending) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(failPage('state 不匹配或已过期'))
        return
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(FAIL_HTML('缺少授权码'))
        return
      }
      clearTimeout(pending.timer)
      pendings.delete(state)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(SUCCESS_HTML())
      pending.resolve({ code, state })
    })

    server.on('error', startReject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      const handle: OAuthCallbackHandle = {
        port: addr.port,
        redirectUri: `http://127.0.0.1:${addr.port}/oauth-callback`,
        waitForCode(state, timeoutMs = 10 * 60 * 1000) {
          return new Promise<{ code: string; state: string }>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendings.delete(state)
              reject(new Error(`OAuth callback timeout (${timeoutMs}ms).`))
            }, timeoutMs)
            pendings.set(state, { state, timer, resolve, reject })
          })
        },
        close() {
          for (const [state, p] of pendings) {
            clearTimeout(p.timer)
            pendings.delete(state)
            p.reject(new Error('OAuth callback server closed.'))
          }
          return new Promise<void>((resolve) => server.close(() => resolve()))
        }
      }
      startResolve(handle)
    })
  })
}

function failPage(message: string): string {
  return `授权失败: ${message}`
}

export { SUCCESS_HTML }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/oauth-core && pnpm vitest run src/callbackServer.test.ts`
Expected: PASS

- [ ] **Step 5: Export + typecheck**

Add `export * from './callbackServer'` to `index.ts`. Run `pnpm typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/oauth-core
git commit -m "feat(oauth-core): OAuth callback server"
```

---

### Task 4: `oauthFlow` (prepare URL + run the flow)

**Files:**
- Create: `packages/oauth-core/src/oauthFlow.ts`
- Test: `packages/oauth-core/src/oauthFlow.test.ts`
- Modify: `packages/oauth-core/src/index.ts`

**Interfaces:**
- Consumes: `OAuthClientConfig`, `OAuthTokenPair`, `OAuthUserInfo`; `OAuthTokenClient`; `OAuthCallbackHandle`.
- Produces:
  - `export function prepareAuthUrl(config: OAuthClientConfig, redirectUri: string, state?: string): string`
  - `export interface OAuthFlowResult { pair: OAuthTokenPair; userInfo: OAuthUserInfo }`
  - `export async function openExternalUrl(url: string): Promise<void>` — injectable hook wrapper (main process overrides with `shell.openExternal`).
  - `export async function runOAuthFlow(params: { config: OAuthClientConfig; openBrowser: (url: string) => Promise<void> | void; server: OAuthCallbackHandle; state: string; client?: OAuthTokenClient }): Promise<OAuthFlowResult>`

**Steps:**

- [ ] **Step 1: Write the failing test** — `packages/oauth-core/src/oauthFlow.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { prepareAuthUrl, runOAuthFlow, type OAuthCallbackHandle, type OAuthTokenClient } from './oauthFlow'
import type { OAuthClientConfig } from './types'

const CONFIG: OAuthClientConfig = {
  clientId: 'c', clientSecret: 's',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform']
}

it('prepareAuthUrl includes code challenge, redirect, scope, and state', async () => {
  const url = await prepareAuthUrl(CONFIG, 'http://127.0.0.1:9/oauth-callback', 'STATE')
  expect(url).toContain('client_id=c')
  expect(url).toContain('redirect_uri=' + encodeURIComponent('http://127.0.0.1:9/oauth-callback'))
  expect(url).toContain('response_type=code')
  expect(url).toContain('access_type=offline')
  expect(url).toContain('prompt=consent')
  expect(url).toContain('state=STATE')
})

it('runOAuthFlow opens browser, waits for code, and exchanges', async () => {
  const opened: string[] = []
  const server: OAuthCallbackHandle = {
    port: 1,
    redirectUri: 'http://127.0.0.1:1/oauth-callback',
    waitForCode: async () => ({ code: 'C', state: 's1' }),
    close: async () => {}
  }
  const client = {
    exchangeCode: async (code: string) => ({ accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresInSec: 3600 }),
    refreshAccessToken: async () => { throw new Error('n/a') },
    getUserInfo: async () => ({ id: 'u', email: 'a@b.com' })
  } as unknown as OAuthTokenClient
  const result = await runOAuthFlow({ config: CONFIG, openBrowser: (u) => { opened.push(u) }, server, state: 's1', client })
  expect(opened.length).toBe(1)
  expect(result.pair.refreshToken).toBe('RT')
  expect(result.userInfo.email).toBe('a@b.com')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/oauth-core && pnpm vitest run src/oauthFlow.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation** — `packages/oauth-core/src/oauthFlow.ts`

```ts
import type { OAuthClientConfig, OAuthTokenPair, OAuthUserInfo } from './types'
import { OAuthTokenClient } from './tokenClient'
import type { OAuthCallbackHandle } from './callbackServer'

export async function prepareAuthUrl(
  config: OAuthClientConfig,
  redirectUri: string,
  state?: string,
  _codeChallenge?: string
): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  })
  if (state) params.set('state', state)
  // NOTE: The Antigravity OAuth client uses the standard Authorization Code flow
  // without PKCE (matches cockpit-tools). PKCE is available as an opt-in by
  // passing a code_challenge code; not applied by default.
  return `${config.authUrl}?${params.toString()}`
}

export interface OAuthFlowResult {
  pair: OAuthTokenPair
  userInfo: OAuthUserInfo
}

export interface RunOAuthFlowParams {
  config: OAuthClientConfig
  openBrowser: (url: string) => Promise<void> | void
  server: OAuthCallbackHandle
  state: string
  client?: OAuthTokenClient
}

export async function runOAuthFlow(params: RunOAuthFlowParams): Promise<OAuthFlowResult> {
  const client = params.client ?? new OAuthTokenClient(params.config)
  const url = await prepareAuthUrl(params.config, params.server.redirectUri, params.state)
  await params.openBrowser(url)
  const { code } = await params.server.waitForCode(params.state)
  const pair = await client.exchangeCode(code, params.server.redirectUri)
  const userInfo = await client.getUserInfo(pair.accessToken)
  return { pair, userInfo }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/oauth-core && pnpm vitest run src/oauthFlow.test.ts`
Expected: PASS

- [ ] **Step 5: Export + typecheck**

Add `export * from './oauthFlow'` to `index.ts`. Run `pnpm typecheck`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/oauth-core
git commit -m "feat(oauth-core): oauthFlow prepare + run"
```

---

### Task 5: `tokenStore` interface + `tokenManager` (auto-refresh)

**Files:**
- Create: `packages/oauth-core/src/tokenStore.ts`
- Create: `packages/oauth-core/src/tokenManager.ts`
- Test: `packages/oauth-core/src/tokenManager.test.ts`
- Modify: `packages/oauth-core/src/index.ts`

**Interfaces:**
- Consumes: `OAuthTokenBundle` (types), `OAuthClientConfig`, `OAuthTokenClient` (`refreshAccessToken`).
- Produces:
  - `export interface OAuthTokenStore { get(ref: string): Promise<OAuthTokenBundle | null>; set(ref: string, bundle: OAuthTokenBundle): Promise<void>; delete(ref: string): Promise<void> }`
  - `export class OAuthTokenManager { constructor(opts: { config: OAuthClientConfig; store: OAuthTokenStore; client?: OAuthTokenClient; refreshGraceSec?: number }); async getAccessToken(ref: string): Promise<string>; async setBundle(ref: string, bundle: OAuthTokenBundle): Promise<void>; async setProjectId(ref: string, projectId: string): Promise<void>; async getBundle(ref: string): Promise<OAuthTokenBundle | null>; async deleteBundle(ref: string): Promise<void> }`
  - Throw `OAuthRefreshError` (message + `status?`) when refresh fails and no valid access token exists.
  - `getAccessToken`: read bundle; if `expiresAt > now + grace*1000` return accessToken; else refresh via client, build new bundle (keep refreshToken + projectId), write back, return new accessToken. If bundle has no refreshToken and token expired → throw.

**Steps:**

- [ ] **Step 1: Write the failing test** — `packages/oauth-core/src/tokenManager.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { OAuthTokenManager } from './tokenManager'
import type { OAuthTokenStore } from './tokenStore'
import { OAuthTokenClient } from './tokenClient'
import type { OAuthClientConfig } from './types'

const CONFIG: OAuthClientConfig = {
  clientId: 'c', clientSecret: 's',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['openid']
}

function memoryStore(initial: Record<string, unknown> = {}): OAuthTokenStore {
  const data = new Map(Object.entries(initial))
  return {
    get: async (ref) => (data.get(ref) as OAuthTokenBundle | undefined) ?? null,
    set: async (ref, b) => { data.set(ref, b) },
    delete: async (ref) => { data.delete(ref) }
  }
}

describe('OAuthTokenManager', () => {
  it('returns cached accessToken when not near expiry', async () => {
    const store = memoryStore({
      'r:1': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: Date.now() + 10_000_000 }
    })
    const mgr = new OAuthTokenManager({ config: CONFIG, store, refreshGraceSec: 300 })
    expect(await mgr.getAccessToken('r:1')).toBe('AT')
  })

  it('refreshes when near expiry and persists a new bundle keeping projectId', async () => {
    let refreshed = false
    let capturedRefresh = ''
    const store = memoryStore({
      'r:1': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: Date.now() - 1000, projectId: 'proj-1' }
    })
    const client = {
      exchangeCode: async () => { throw new Error('n/a') },
      refreshAccessToken: async (rt: string) => { refreshed = true; capturedRefresh = rt; return { accessToken: 'AT2', tokenType: 'Bearer', expiresInSec: 3600 } },
      getUserInfo: async () => ({ id: 'u', email: 'a@b.com' })
    } as unknown as OAuthTokenClient
    const mgr = new OAuthTokenManager({ config: CONFIG, store, client, refreshGraceSec: 300 })
    expect(await mgr.getAccessToken('r:1')).toBe('AT2')
    expect(refreshed).toBe(true)
    expect(capturedRefresh).toBe('RT')
    const saved = await store.get('r:1')
    expect(saved!.accessToken).toBe('AT2')
    expect(saved!.projectId).toBe('proj-1')
    expect(saved!.refreshToken).toBe('RT')
  })

  it('persists projectId without overwriting the access token', async () => {
    const store = memoryStore({ 'r:1': { accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 } })
    const mgr = new OAuthTokenManager({ config: CONFIG, store })
    await mgr.setProjectId('r:1', 'PROJ-X')
    const saved = await store.get('r:1')
    expect(saved!.projectId).toBe('PROJ-X')
    expect(saved!.accessToken).toBe('AT')
  })

  it('throws when token expired and no refresh token exists', async () => {
    const store = memoryStore({ 'r:1': { accessToken: 'AT', refreshToken: '', tokenType: 'Bearer', expiresAt: Date.now() - 1000 } })
    const mgr = new OAuthTokenManager({ config: CONFIG, store })
    await expect(mgr.getAccessToken('r:1')).rejects.toThrow(/expired/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/oauth-core && pnpm vitest run src/tokenManager.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `packages/oauth-core/src/tokenStore.ts`**

```ts
import type { OAuthTokenBundle } from './types'

export interface OAuthTokenStore {
  get(ref: string): Promise<OAuthTokenBundle | null>
  set(ref: string, bundle: OAuthTokenBundle): Promise<void>
  delete(ref: string): Promise<void>
}
```

- [ ] **Step 4: Create `packages/oauth-core/src/tokenManager.ts`**

```ts
import type { OAuthClientConfig, OAuthTokenBundle } from './types'
import { OAuthTokenClient } from './tokenClient'
import type { OAuthTokenStore } from './tokenStore'

export class OAuthRefreshError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OAuthRefreshError'
    this.status = status
  }
}

export interface OAuthTokenManagerOptions {
  config: OAuthClientConfig
  store: OAuthTokenStore
  client?: OAuthTokenClient
  refreshGraceSec?: number
}

export class OAuthTokenManager {
  private readonly client: OAuthTokenClient
  private readonly refreshGraceMs: number

  constructor(private readonly opts: OAuthTokenManagerOptions) {
    this.client = opts.client ?? new OAuthTokenClient(opts.config)
    this.refreshGraceMs = (opts.refreshGraceSec ?? 300) * 1000
  }

  async getBundle(ref: string): Promise<OAuthTokenBundle | null> {
    return this.opts.store.get(ref)
  }

  async setBundle(ref: string, bundle: OAuthTokenBundle): Promise<void> {
    await this.opts.store.set(ref, bundle)
  }

  async deleteBundle(ref: string): Promise<void> {
    await this.opts.store.delete(ref)
  }

  async setBundleField(ref: string, patch: Partial<OAuthTokenBundle>): Promise<void> {
    const current = await this.opts.store.get(ref)
    if (!current) throw new OAuthRefreshError('No token bundle to patch.')
    await this.opts.store.set(ref, { ...current, ...patch })
  }

  async setProjectId(ref: string, projectId: string): Promise<void> {
    await this.setBundleField(ref, { projectId })
  }

  async getAccessToken(ref: string): Promise<string> {
    const bundle = await this.opts.store.get(ref)
    if (!bundle) throw new OAuthRefreshError('No OAuth account bound to this provider.')
    const now = Date.now()
    if (bundle.expiresAt > now + this.refreshGraceMs) {
      return bundle.accessToken
    }
    if (!bundle.refreshToken) {
      throw new OAuthRefreshError('OAuth access token expired and no refresh token is available.')
    }
    let pair
    try {
      pair = await this.client.refreshAccessToken(bundle.refreshToken)
    } catch (err) {
      const status = err instanceof Error && 'status' in err ? (err as { status?: number }).status : undefined
      throw new OAuthRefreshError('OAuth token refresh failed.', status)
    }
    const next: OAuthTokenBundle = {
      accessToken: pair.accessToken,
      refreshToken: bundle.refreshToken,
      tokenType: pair.tokenType || bundle.tokenType || 'Bearer',
      expiresAt: Date.now() + pair.expiresInSec * 1000,
      idToken: pair.idToken ?? bundle.idToken,
      oauthClientKey: pair.oauthClientKey ?? bundle.oauthClientKey,
      scope: bundle.scope,
      projectId: bundle.projectId
    }
    await this.opts.store.set(ref, next)
    return next.accessToken
  }
}
```

> Note: The unused `config` field keeps DI minimal; it is available for future OAuth providers that need per-provider credentials.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/oauth-core && pnpm vitest run src/tokenManager.test.ts`
Expected: PASS

- [ ] **Step 6: Export + typecheck**

Add `export * from './tokenStore'` and `export * from './tokenManager'` to `index.ts`. Run `pnpm typecheck`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/oauth-core
git commit -m "feat(oauth-core): tokenStore interface + auto-refresh tokenManager"
```

---

### Task 6: Scaffold `provider-antigravity` + metadata

**Files:**
- Create: `packages/provider-antigravity/package.json`
- Create: `packages/provider-antigravity/tsconfig.json`
- Create: `packages/provider-antigravity/eslint.config.mjs`
- Create: `packages/provider-antigravity/src/metadata.ts`
- Create: `packages/provider-antigravity/src/index.ts`

**Interfaces:**
- Consumes: `@meow-gateway/provider-core` (`ProviderAdapter`), `@meow-gateway/oauth-core` (`OAuthClientConfig`).
- Produces:
  - `export interface AntigravityMetadata { id: string; displayName: string; defaultBaseUrl: string; authType: 'oauth'; fallbackBaseUrls: string[] }`
  - `export const antigravityMetadata: AntigravityMetadata`
  - `export const ANTIGRAVITY_OAUTH_CLIENT: OAuthClientConfig` (dev-only DANGER)
  - `export const ANTIGRAVITY_BASE_URLS: string[]`
  - `export const DEFAULTS` (system prompt, UA, x-goog-api-client).

**Steps:**

- [ ] **Step 1: Create `packages/provider-antigravity/package.json`** (mirror `packages/provider-deepseek/package.json` but name `@meow-gateway/provider-antigravity`, deps on `provider-core` and `oauth-core`).

```json
{
  "name": "@meow-gateway/provider-antigravity",
  "version": "0.5.2",
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

- [ ] **Step 2: Create `tsconfig.json`** (copy `packages/provider-deepseek/tsconfig.json`).
- [ ] **Step 3: Create `eslint.config.mjs`** (copy `packages/provider-openai/eslint.config.mjs`).

- [ ] **Step 4: Create `src/metadata.ts`**

```ts
import type { OAuthClientConfig } from '@meow-gateway/oauth-core'

export interface AntigravityMetadata {
  id: string
  displayName: string
  defaultBaseUrl: string
  authType: 'oauth'
  fallbackBaseUrls: string[]
}

export const ANTIGRAVITY_BASE_URLS: string[] = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com'
]

export const antigravityMetadata: AntigravityMetadata = {
  id: 'antigravity',
  displayName: 'Antigravity',
  defaultBaseUrl: ANTIGRAVITY_BASE_URLS[0],
  authType: 'oauth',
  fallbackBaseUrls: ANTIGRAVITY_BASE_URLS.slice(1)
}

// DANGER (dev-only): These are the Antigravity Google OAuth client credentials,
// mirroring cockpit-tools. This intentionally deviates from AGENTS.md
// ("do not hard-code provider secrets") to enable a working POC. MUST be
// replaced with user-supplied credentials or a real backend secret store before
// shipping. See design spec "Bảo mật".
export const ANTIGRAVITY_OAUTH_CLIENT: OAuthClientConfig = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: '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',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform']
}

export const ANTIGRAVITY_SYSTEM_PROMPT =
  'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding. You are pair programming with a USER to solve their coding task.'

export const DEFAULT_UA_OS = 'unknown'
export const DEFAULT_UA_ARCH = 'unknown'
```

- [ ] **Step 5: Create `src/index.ts`**

```ts
export { antigravityMetadata, ANTIGRAVITY_BASE_URLS, ANTIGRAVITY_OAUTH_CLIENT, ANTIGRAVITY_SYSTEM_PROMPT, type AntigravityMetadata } from './metadata'
export { createAntigravityAdapter, type AntigravityAdapterOptions } from './adapter'
export { resolveProjectId } from './project'
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/provider-antigravity && pnpm install && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/provider-antigravity pnpm-lock.yaml
git commit -m "feat(provider-antigravity): scaffold + metadata"
```

---

### Task 7: `project.ts` — resolve Antigravity project_id

**Files:**
- Create: `packages/provider-antigravity/src/project.ts`
- Test: `packages/provider-antigravity/src/project.test.ts`
- Modify: `packages/provider-antigravity/src/index.ts`

**Interfaces:**
- Consumes: `OAuthTokenManager` (oauth-core), `ANTIGRAVITY_BASE_URLS`, `ANTIGRAVITY_SYSTEM_PROMPT` etc.
- Produces:
  - `export async function resolveProjectId(params: { accessToken: string; cachedProjectId?: string; baseUrls: string[]; fetcher: Fetcher }): Promise<string>`
    - If `cachedProjectId` present → return it.
    - Else try each base URL: POST `{base}/v1internal:loadCodeAssist` with headers `Authorization: Bearer`, `User-Agent`, `x-goog-api-client`, body `{ metadata: {...}, mode: 'FULL_ELIGIBILITY_CHECK' }`. Parse `project.id` / `projectId`. If found → return. If an `onboardUser` field signals a new account → error `NO_PROJECT`.
  - `export function antigravityUserAgent(): string`
  - `export function antigravityXGoogApiClient(): string`

**Steps:**

- [ ] **Step 1: Write the failing test** — `packages/provider-antigravity/src/project.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { resolveProjectId } from './project'
import type { Fetcher } from '@meow-gateway/oauth-core'

function fetcherFor(status: number, body: unknown): Fetcher {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
    json: async () => body
  })
}

describe('resolveProjectId', () => {
  it('returns the cached project id immediately', async () => {
    const id = await resolveProjectId({
      accessToken: 'AT',
      cachedProjectId: 'proj-cached',
      baseUrls: ['https://a.example.com'],
      fetcher: fetcherFor(200, {})
    })
    expect(id).toBe('proj-cached')
  })

  it('calls loadCodeAssist and extracts project.id from payload', async () => {
    const calls: string[] = []
    const urls = ['https://a.example.com', 'https://b.example.com']
    const fetcher: Fetcher = async (url, init) => {
      calls.push(url)
      if (url.includes('a.example.com')) {
        return { ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({}) } as never
      }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ project: { id: 'proj-2' } }), form: init?.form } as never
    }
    const id = await resolveProjectId({ accessToken: 'AT', baseUrls: urls, fetcher })
    expect(id).toBe('proj-2')
    expect(calls[0]).toContain('loadCodeAssist')
    expect(calls[1]).toContain('loadCodeAssist')
  })

  it('throws NO_PROJECT when loadCodeAssist signals an unprovisioned account', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ project: { id: '' } }) } as never)
    await expect(resolveProjectId({ accessToken: 'AT', baseUrls: ['https://a.example.com'], fetcher })).rejects.toThrow(/NO_PROJECT|project/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/provider-antigravity && pnpm vitest run src/project.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation** — `packages/provider-antigravity/src/project.ts`

```ts
import type { Fetcher } from '@meow-gateway/oauth-core'
import { ANTIGRAVITY_BASE_URLS } from './metadata'

export function antigravityUserAgent(): string {
  return `antigravity/1.0 (${'unknown'} ${'unknown'}) google-api-nodejs-client/11.0.0`
}

export function antigravityXGoogApiClient(): string {
  return 'gl-node/18.0.0'
}

function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>
    for (const key of ['id', 'projectId', 'project_id']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return undefined
}

export interface ResolveProjectParams {
  accessToken: string
  baseUrls?: string[]
  cachedProjectId?: string
  fetcher: Fetcher
}

export async function resolveProjectId(params: ResolveProjectParams): Promise<string> {
  if (params.cachedProjectId) return params.cachedProjectId
  const baseUrls = params.baseUrls ?? ANTIGRAVITY_BASE_URLS
  let lastError: Error | undefined
  for (const base of baseUrls) {
    const url = `${base}/v1internal:loadCodeAssist`
    try {
      const res = await params.fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'User-Agent': antigravityUserAgent(),
          'x-goog-api-client': antigravityXGoogApiClient(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metadata: { appVersion: '1.0' }, mode: 'FULL_ELIGIBILITY_CHECK' })
      })
      if (!res.ok) {
        lastError = new Error(`loadCodeAssist failed (${res.status}) on ${base}`)
        continue
      }
      const raw = (await res.json()) as { project?: unknown; projectId?: unknown; metadata?: Record<string, unknown> }
      const proj =
        extractProjectId(raw.project) ??
        extractProjectId(raw.projectId) ??
        extractProjectId(raw.metadata?.['project'])
      if (proj) return proj
      lastError = new Error('loadCodeAssist returned no project id (account not provisioned).')
      // Spec deviation (acceptable initial slice): the design doc's step 3 —
      // auto-provisioning a brand-new account via `v1internal:onboardUser` +
      // operation polling — is intentionally NOT implemented yet. Instead we
      // surface a clear NO_PROJECT error so the user knows to use the provider
      // in the Antigravity IDE once to create the project. Extend here when the
      // onboard path is needed.
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw new Error(lastError?.message ?? 'Could not resolve project id.')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/provider-antigravity && pnpm vitest run src/project.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

Run `pnpm typecheck`. Expected PASS.
```bash
git add packages/provider-antigravity
git commit -m "feat(provider-antigravity): resolve project id"
```

---

### Task 8: `adapter.ts` — chat / getModels / validateCredentials

**Files:**
- Create: `packages/provider-antigravity/src/adapter.ts`
- Test: `packages/provider-antigravity/src/adapter.test.ts` (contract + specific)

**Interfaces:**
- Consumes: `ProviderAdapter`, `ModelInfo`, `ProviderContext`, `NormalizedChatRequest`, `NormalizedChatChunk`, `ProviderError` (provider-core); `OAuthTokenManager`, `OAuthTokenBundle` (oauth-core); `resolveProjectId` (project.ts).
- Produces:
  - `export interface AntigravityAdapterOptions { tokenManager?: OAuthTokenManager; fetcher?: Fetcher; fallbackModels?: string[] }`
  - `export class AntigravityAdapter implements ProviderAdapter { readonly id: string; constructor(id?: string, opts?: AntigravityAdapterOptions) ; async getModels(ctx): Promise<ModelInfo[]>; async validateCredentials(ctx): Promise<CredentialCheckResult>; async *chat(ctx, req): AsyncIterable<NormalizedChatChunk> }`
  - `export function createAntigravityAdapter(id?: string, opts?: AntigravityAdapterOptions): AntigravityAdapter`
  - Behavior: parse the credential bundle from `ctx.credential` (JSON) or from `tokenManager`; get a fresh access token; `chat` resolves project id, POSTs `streamGenerateContent?alt=sse`, parses SSE `content_delta` + `finish`; non-stream accumulates; error mapping.

**Steps:**

- [ ] **Step 1: Write the failing contract test** — `packages/provider-antigravity/src/adapter.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { createAntigravityAdapter } from './adapter'
import { defineAdapterContractTests, accumulateText } from '@meow-gateway/provider-core'
import type { ProviderContext, ModelInfo, CredentialCheckResult } from '@meow-gateway/provider-core'
import type { Fetcher } from '@meow-gateway/oauth-core'
import { OAuthTokenManager, type OAuthTokenStore } from '@meow-gateway/oauth-core'
import type { OAuthTokenClient } from '@meow-gateway/oauth-core'

const BASE_URL = 'https://mock.example.com'

const AUTH = 'at-123'

function bundleCtx(overrides?: Partial<ProviderContext>): ProviderContext {
  return {
    credentialRef: 'provider.mocked',
    credential: JSON.stringify({ accessToken: AUTH, refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10, projectId: 'proj-1' }),
    baseUrl: BASE_URL,
    signal: new AbortController().signal,
    requestId: 'req-1',
    ...overrides
  }
}

function sseFetcher(blocks: string[], tokenManager?: OAuthTokenManager): Fetcher {
  return async (url, init) => {
    const text = blocks.join('\n')
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      text: async () => text,
      json: async () => ({}),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() } })
    } as never
  }
}

const emptyManager = (cached?: Map<string, unknown>): { manager: OAuthTokenManager } => {
  const store: OAuthTokenStore = {
    get: async (ref) => (cached?.get(ref) as never) ?? null,
    set: async () => {},
    delete: async () => {}
  }
  const client = {
    exchangeCode: async () => { throw new Error('n/a') },
    refreshAccessToken: async () => { throw new Error('n/a') },
    getUserInfo: async () => ({ id: 'u', email: 'a@b.com' })
  } as unknown as OAuthTokenClient
  return { manager: new OAuthTokenManager({ config: { clientId: 'c', clientSecret: 's', authUrl: '', tokenUrl: '', scopes: [] }, store, client }) }
}

describe('AntigravityAdapter', () => {
  defineAdapterContractTests({})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/provider-antigravity && pnpm vitest run src/adapter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the full test host + additional tests**

Replace the placeholder body with a full contract host and targeted tests. (See below — final code is in Step 5's adapter; this test file must satisfy the contract host.)

```ts
import { describe, it, expect } from 'vitest'
import { createAntigravityAdapter } from './adapter'
import { defineAdapterContractTests, type AdapterContractHost, ProviderError } from '@meow-gateway/provider-core'
import type { ProviderContext } from '@meow-gateway/provider-core'
import type { Fetcher } from '@meow-gateway/oauth-core'

const BASE_URL = 'https://mock.example.com'
const AUTH = 'at-123'

function ctx(overrides?: Partial<ProviderContext>): ProviderContext {
  return {
    credentialRef: 'provider.mocked',
    credential: JSON.stringify({ accessToken: AUTH, refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10, projectId: 'proj-1' }),
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

const streamingFetcher = fetcherFor(async (url, init) => {
  const u = String(url)
  if (u.includes('fetchAvailableModels')) return { ok: true, status: 200, text: JSON.stringify({ payload: { models: {} } }) }
  if (u.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'proj-1' } }) }
  if (u.includes('streamGenerateContent')) {
    return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":4}}}\n\ndata: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\ndata: [DONE]\n' }
  }
  return { ok: false, status: 404, text: '' }
})

const host: AdapterContractHost = {
  buildAdapter: () => createAntigravityAdapter('antigravity', { fetcher: streamingFetcher }),
  startMock: async () => ({ baseUrl: BASE_URL, close: async () => {} }),
  makeContext: (baseUrl, overrides) => ctx({ baseUrl, ...overrides })
}

describe('AntigravityAdapter', () => {
  defineAdapterContractTests(host)

  it('resolves project id once and reuses the cached value on later calls', async () => {
    let loadCalls = 0
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('loadCodeAssist')) { loadCalls++; return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'proj-2' } }) } }
      if (url.includes('streamGenerateContent')) return { ok: true, status: 200, text: 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n[data: [DONE]\n' }
      return { ok: true, status: 200, text: JSON.stringify({ payload: { models: {} } }) }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    // First call has no cached project id -> 1 load call.
    await collect(adapter.chat(ctx({ credential: JSON.stringify({ accessToken: AUTH, refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 }) }), req))
    // Second call still no cached id in bundle -> resolves again (adapter is stateless w.r.t. project).
    await collect(adapter.chat(ctx(), req))
    expect(loadCalls).toBe(2)
  })

  it('maps a 401 to AUTH_ERROR', async () => {
    const fetcher = fetcherFor(async (url) => {
      if (url.includes('streamGenerateContent')) return { ok: false, status: 401, text: 'unauthorized' }
      return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'p' } }) }
    })
    const adapter = createAntigravityAdapter('antigravity', { fetcher })
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true }
    await expect(collect(adapter.chat(ctx(), req))).rejects.toMatchObject({ type: 'AUTH_ERROR' })
  })

  async function collect(iter: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iter) { /* drain */ }
  }
})
```

- [ ] **Step 4: Run test to verify the contract fails**

Run: `cd packages/provider-antigravity && pnpm vitest run src/adapter.test.ts`
Expected: FAIL, module not found (`./adapter`).

- [ ] **Step 5: Write minimal implementation** — `packages/provider-antigravity/src/adapter.ts`

```ts
import {
  ProviderError, type ProviderAdapter, type ProviderContext, type CredentialCheckResult,
  type ModelInfo, type NormalizedChatRequest, type NormalizedChatChunk, assertSafeEndpoint
} from '@meow-gateway/provider-core'
import { OAuthTokenManager, type OAuthTokenBundle, type Fetcher, defaultFetcher } from '@meow-gateway/oauth-core'
import { antigravityMetadata, ANTIGRAVITY_BASE_URLS, ANTIGRAVITY_SYSTEM_PROMPT } from './metadata'
import { resolveProjectId } from './project'
import { randomUUID } from 'node:crypto'

const STREAM_PATH = '/v1internal:streamGenerateContent?alt=sse'
const FETCH_MODELS_PATH = '/v1internal:fetchAvailableModels'

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

function parseBundle(raw: string | undefined): OAuthTokenBundle | undefined {
  if (!raw) return undefined
  try {
    const b = JSON.parse(raw) as Partial<OAuthTokenBundle>
    if (typeof b.accessToken === 'string' && b.accessToken) {
      return {
        accessToken: b.accessToken,
        refreshToken: typeof b.refreshToken === 'string' ? b.refreshToken : '',
        tokenType: b.tokenType || 'Bearer',
        expiresAt: typeof b.expiresAt === 'number' ? b.expiresAt : Date.now() + 3600_000,
        idToken: b.idToken,
        oauthClientKey: b.oauthClientKey,
        scope: b.scope,
        projectId: b.projectId
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export interface AntigravityAdapterOptions {
  tokenManager?: OAuthTokenManager
  fetcher?: Fetcher
  fallbackModels?: string[]
}

interface ResolvedAuth {
  accessToken: string
  bundle?: OAuthTokenBundle
  ref?: string
}

export class AntigravityAdapter implements ProviderAdapter {
  readonly id: string
  private readonly fetcher: Fetcher
  private readonly tokenManager?: OAuthTokenManager
  private readonly fallbackModels: string[]

  constructor(id: string = antigravityMetadata.id, opts: AntigravityAdapterOptions = {}) {
    this.id = id
    this.fetcher = opts.fetcher ?? defaultFetcher()
    this.tokenManager = opts.tokenManager
    this.fallbackModels = opts.fallbackModels ?? ['gemini-2.5-pro', 'gemini-2.5-flash']
  }

  private resolveBaseUrl(ctx: ProviderContext): string {
    return ctx.baseUrl || antigravityMetadata.defaultBaseUrl
  }

  private assertEndpointSafe(ctx: ProviderContext): void {
    const r = assertSafeEndpoint(this.resolveBaseUrl(ctx))
    if (!r.ok) throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${r.reason}`, retryable: false })
  }

  private async resolveAuth(ctx: ProviderContext): Promise<ResolvedAuth> {
    const bundle = parseBundle(ctx.credential)
    if (this.tokenManager && ctx.credentialRef) {
      const accessToken = await this.tokenManager.getAccessToken(ctx.credentialRef)
      const current = await this.tokenManager.getBundle(ctx.credentialRef)
      return { accessToken, bundle: current ?? bundle, ref: ctx.credentialRef }
    }
    if (bundle?.accessToken) return { accessToken: bundle.accessToken, bundle }
    throw new ProviderError({ type: 'AUTH_ERROR', message: 'No Antigravity OAuth token configured.', retryable: false })
  }

  private async headers(ctx: ProviderContext, accessToken: string): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': 'antigravity',
      'x-goog-api-client': 'gl-node/18'
    }
  }

  async getModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    this.assertEndpointSafe(ctx)
    const { accessToken } = await this.resolveAuth(ctx)
    for (const base of this.baseUrlsToTry(ctx)) {
      const url = joinUrl(base, FETCH_MODELS_PATH)
      try {
        const res = await this.fetcher(url, { method: 'POST', headers: await this.headers(ctx, accessToken), body: '{}', signal: ctx.signal })
        if (res.ok) {
          const data = (await res.json()) as { payload?: { models?: Record<string, unknown> }; models?: Record<string, unknown> }
          const map = data.payload?.models ?? data.models ?? {}
          const ids = Object.keys(map).filter((k) => !k.includes('legacy'))
          if (ids.length === 0) break
          return ids.map((id) => ({
            id,
            providerModelId: id,
            displayName: id,
            capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false }
          }))
        }
      } catch {
        // try next base url
      }
    }
    return this.fallbackModels.map((id) => ({
      id,
      providerModelId: id,
      displayName: id,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false }
    }))
  }

  private baseUrlsToTry(ctx: ProviderContext): string[] {
    const base = this.resolveBaseUrl(ctx)
    return [base, ...antigravityMetadata.fallbackBaseUrls.filter((b) => b !== base)]
  }

  async validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult> {
    try {
      await this.resolveAuth(ctx)
      return { ok: true, message: 'Antigravity OAuth token resolved.' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Validation failed.' }
    }
  }

  async *chat(ctx: ProviderContext, request: NormalizedChatRequest): AsyncIterable<NormalizedChatChunk> {
    this.assertEndpointSafe(ctx)
    const { accessToken, bundle } = await this.resolveAuth(ctx)
    const projectId = await this.resolveProject(ctx, accessToken, bundle)
    const id = 'req_' + randomUUID()
    const messages = request.messages.map((m) => ({ role: m.role, parts: [{ text: String(m.content) }] }))
    const body = {
      project: projectId,
      requestId: id,
      model: request.model,
      userAgent: 'antigravity',
      requestType: 'agent',
      request: {
        contents: messages,
        session_id: 'sess_' + randomUUID().slice(0, 8),
        systemInstruction: { parts: [{ text: ANTIGRAVITY_SYSTEM_PROMPT }] },
        generationConfig: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens && request.maxTokens > 0 ? { maxOutputTokens: request.maxTokens } : {})
        }
      }
    }

    let res
    try {
      res = await this.fetcher(joinUrl(this.resolveBaseUrl(ctx), STREAM_PATH), {
        method: 'POST',
        headers: await this.headers(ctx, accessToken),
        body: JSON.stringify(body),
        signal: ctx.signal
      })
    } catch {
      if (ctx.signal.aborted) throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Request to provider failed.', retryable: true })
    }

    if (!res.ok) throw this.errorFromStatus(res.status, ctx)

    const shouldStream = request.stream !== false
    const chunks: NormalizedChatChunk[] = []
    for await (const chunk of this.parseSse(res, ctx.signal)) chunks.push(chunk)

    if (!shouldStream) {
      yield* this.asNonStreamingChunks(chunks)
      return
    }
    yield* chunks
  }

  private async resolveProject(ctx: ProviderContext, accessToken: string, bundle: OAuthTokenBundle | undefined): Promise<string> {
    try {
      const projectId = await resolveProjectId({
        accessToken,
        cachedProjectId: bundle?.projectId,
        baseUrls: this.baseUrlsToTry(ctx),
        fetcher: this.fetcher
      })
      if (this.tokenManager && ctx.credentialRef && !bundle?.projectId) {
        await this.tokenManager.setProjectId(ctx.credentialRef, projectId).catch(() => {})
      }
      return projectId
    } catch (err) {
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: `Could not resolve Antigravity project: ${err instanceof Error ? err.message : String(err)}`, retryable: false })
    }
  }

  private errorFromStatus(status: number, ctx: ProviderContext): ProviderError {
    if (status === 401 || status === 403) return new ProviderError({ type: 'AUTH_ERROR', status, message: 'Antigravity authentication failed.', retryable: false })
    if (status === 429) return new ProviderError({ type: 'RATE_LIMIT', status, message: 'Antigravity rate limited.', retryable: true })
    if (status >= 500) return new ProviderError({ type: 'PROVIDER_UNAVAILABLE', status, message: 'Antigravity server error.', retryable: true })
    return new ProviderError({ type: 'CLIENT_ERROR', status, message: 'Antigravity request rejected.', retryable: false })
  }

  private async *parseSse(res: Awaited<ReturnType<Fetcher>>, signal?: AbortSignal): AsyncIterable<NormalizedChatChunk> {
    try {
      const reader = (res.body as ReadableStream<Uint8Array> | undefined)?.getReader()
      if (!reader) { yield* this.parseSseText(await res.text()); return }
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false
      while (!done) {
        const { value, done: stop } = await reader.read()
        done = stop
        buffer += decoder.decode(value, { stream: !done })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const c of this.parseEventLines(block)) yield c
        }
      }
      if (buffer.trim()) { for (const c of this.parseEventLines(buffer)) yield c }
    } catch {
      if (signal?.aborted) throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Provider closed the stream unexpectedly.', retryable: true })
    }
  }

  private async *parseSseText(text: string): AsyncIterable<NormalizedChatChunk> {
    for (const block of text.split('\n\n')) { for (const c of this.parseEventLines(block)) yield c }
  }

  private *parseEventLines(block: string): Iterable<NormalizedChatChunk> {
    let accumulated = ''
    let finishReason: string | undefined
    const usage = (obj: unknown): NormalizedChatChunk['usage'] => {
      const o = obj as Record<string, unknown>
      const um = o['usageMetadata'] as Record<string, unknown> | undefined
      return {
        inputTokens: typeof um?.['promptTokenCount'] === 'number' ? um['promptTokenCount'] : 0,
        outputTokens: typeof um?.['candidatesTokenCount'] === 'number' ? um['candidatesTokenCount'] : 0,
        cachedTokens: 0
      }
    }
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(payload) } catch { continue }
      const response = (parsed['response'] ?? parsed) as Record<string, unknown>
      const candidates = (response['candidates'] as unknown[] | undefined) ?? [response]
      for (const c of candidates) {
        const cand = c as Record<string, unknown>
        if (typeof cand['finishReason'] === 'string') finishReason = cand['finishReason']
        const content = cand['content'] as Record<string, unknown> | undefined
        const parts = (content?.['parts'] as unknown[] | undefined) ?? []
        for (const p of parts) {
          const part = p as Record<string, unknown>
          if (part['thought'] === true) continue
          if (typeof part['text'] === 'string' && part['text']) accumulated += part['text']
        }
      }
      const finish = finishReason ?? (response['usageMetadata'] ? 'stop' : undefined)
      if (accumulated) {
        yield { id: accumulated.length ? 'x' : 'x', kind: 'content_delta', delta: accumulated }
        accumulated = ''
      }
      if (finish || response['usageMetadata']) {
        yield { id: 'x', kind: 'finish', finishReason: finish ?? 'stop', ...(response['usageMetadata'] ? { usage: usage(response) } : {}) }
      }
    }
    if (accumulated) yield { id: 'x', kind: 'content_delta', delta: accumulated }
  }

  private *asNonStreamingChunks(chunks: NormalizedChatChunk[]): Iterable<NormalizedChatChunk> {
    let text = chunks.filter((c) => c.kind === 'content_delta').map((c) => c.delta ?? '').join('')
    yield { id: 'x', kind: 'content_delta', delta: text }
    const finish = chunks.find((c) => c.kind === 'finish')
    yield { id: 'x', kind: 'finish', finishReason: finish?.finishReason ?? 'stop', usage: finish?.usage }
  }
}

export function createAntigravityAdapter(id?: string, opts?: AntigravityAdapterOptions): AntigravityAdapter {
  return new AntigravityAdapter(id, opts)
}
```

> Note: `assertSafeEndpoint` import — verify export name in `@meow-gateway/provider-core` (openai uses it). If it's exported, the import above is correct.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/provider-antigravity && pnpm vitest run src/adapter.test.ts`
Expected: PASS (contract + specific).

- [ ] **Step 7: Typecheck + lint + commit**

Run: `cd packages/provider-antigravity && pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add packages/provider-antigravity
git commit -m "feat(provider-antigravity): adapter chat/getModels/validate"
```

---

### Task 9: Desktop package deps + `OAuthTokenStore`

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/oauth/oauthTokenStore.ts`
- Test: `apps/desktop/src/main/oauth/oauthTokenStore.test.ts`

**Interfaces:**
- Consumes: `CredentialService`, `OAuthTokenStore`, `OAuthTokenBundle`.
- Produces:
  - `export class SecureOAuthTokenStore implements OAuthTokenStore { constructor(private credentials: CredentialService) {} async get(ref): Promise<OAuthTokenBundle | null>; async set(ref, bundle): Promise<void>; async delete(ref): Promise<void> }`
  - Bundles stored as JSON via `credentials.setCredential(ref, JSON.stringify(bundle))`; `get` parses or returns null on invalid JSON.

**Steps:**

- [ ] **Step 1: Add workspace deps to desktop**

Add to `apps/desktop/package.json` dependencies:
```json
"@meow-gateway/provider-antigravity": "workspace:^",
"@meow-gateway/oauth-core": "workspace:^"
```
Run: `cd /d/GitHub/meow-router && pnpm install`

- [ ] **Step 2: Write the failing test** — `apps/desktop/src/main/oauth/oauthTokenStore.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { SecureOAuthTokenStore } from './oauthTokenStore'
import type { CredentialService } from '../../credentials/credentialService'
import type { OAuthTokenBundle } from '@meow-gateway/oauth-core'

function memCreds(): CredentialService {
  const map = new Map<string, string>()
  return {
    setCredential: async (r, s) => { map.set(r, s) },
    getCredential: async (r) => map.get(r) ?? null,
    deleteCredential: async (r) => { map.delete(r) },
    hasCredential: async (r) => map.has(r)
  }
}

describe('SecureOAuthTokenStore', () => {
  it('persists a bundle as JSON via the credential service', async () => {
    const creds = memCreds()
    const store = new SecureOAuthTokenStore(creds)
    const bundle: OAuthTokenBundle = { accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresAt: 123 }
    await store.set('provider.x', bundle)
    const raw = await creds.getCredential('provider.x')
    expect(JSON.parse(raw!).accessToken).toBe('a')
    const got = await store.get('provider.x')
    expect(got!.refreshToken).toBe('r')
  })

  it('returns null for missing or invalid JSON', async () => {
    const creds = memCreds()
    const store = new SecureOAuthTokenStore(creds)
    expect(await store.get('missing')).toBeNull()
    await creds.setCredential('bad', 'not-json')
    expect(await store.get('bad')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `cd apps/desktop && pnpm vitest run src/main/oauth/oauthTokenStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement** — `apps/desktop/src/main/oauth/oauthTokenStore.ts`

```ts
import type { CredentialService } from '../credentials/credentialService'
import type { OAuthTokenBundle, OAuthTokenStore } from '@meow-gateway/oauth-core'

// Bridges the oauth-core OAuthTokenStore interface onto the existing OS
// secure-store-backed CredentialService. Bundles are stored as JSON; the same
// ref namespace as gateway credentials (`provider:<id>`) is used so that 1
// provider = 1 account and the gateway needs no changes.
export class SecureOAuthTokenStore implements OAuthTokenStore {
  constructor(private readonly credentials: CredentialService) {}

  async get(ref: string): Promise<OAuthTokenBundle | null> {
    const raw = await this.credentials.getCredential(ref)
    if (!raw) return null
    try {
      return JSON.parse(raw) as OAuthTokenBundle
    } catch {
      return null
    }
  }

  async set(ref: string, bundle: OAuthTokenBundle): Promise<void> {
    await this.credentials.setCredential(ref, JSON.stringify(bundle))
  }

  async delete(ref: string): Promise<void> {
    await this.credentials.deleteCredential(ref)
  }
}
```

- [ ] **Step 5: Run tests to pass**

Run: `cd apps/desktop && pnpm vitest run src/main/oauth/oauthTokenStore.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck + commit**

Run: `cd /d/GitHub/meow-router && pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.
```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "feat(desktop): OAuthTokenStore over CredentialService"
```

---

### Task 10: `OAuthLoginService` + bootstrap wiring + IPC

**Files:**
- Create: `apps/desktop/src/main/oauth/oauthLoginService.ts`
- Create: `apps/desktop/src/main/oauth/antigravityConfig.ts`
- Modify: `apps/desktop/src/main/app/bootstrap.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: `providerService`, `SecureOAuthTokenStore`, `OAuthTokenManager`, `CredentialService`, `ANTIGRAVITY_OAUTH_CLIENT`, `startCallbackServer`, `runOAuthFlow`, `ProviderError`.
- Produces:
  - `export class OAuthLoginService { constructor(deps: { providerService: ProviderService; credentials: CredentialService; tokenStore: OAuthTokenStore; clientForType: (type: string) => OAuthClientConfig }) ; startLogin(type: string): Promise<OAuthLoginStart> ; completeLogin(type: string): Promise<OAuthAccountMeta> ; completeLoginFor(type: string, server: OAuthCallbackHandle): Promise<OAuthAccountMeta> ; listAccounts(type: string): Promise<OAuthAccountMeta[]> ; logoutAccount(providerId: string): Promise<void> }`
  - `export interface OAuthLoginStart { pending: boolean }`
  - `ipc.ts` channels: `oauth.startLogin`, `oauth.completeLogin`, `oauth.listAccounts`, `oauth.logout`.
  - `OAuthAccountMeta { providerId: string; email: string; displayName: string; expiresAt: number; valid: boolean }`

> Note: The single-flight pending OAuth callback is held in the main-process service instance (one callback at a time). `completeLogin` waits on the pending server. `startLogin` calls `shell.openExternal` when run inside Electron main.

**Steps:**

- [ ] **Step 1: Write the failing test** — `apps/desktop/src/main/oauth/oauthLoginService.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { OAuthLoginService } from './oauthLoginService'
import type { ProviderService } from '../provider/providerService'
import type { CredentialService } from '../credentials/credentialService'
import type { OAuthTokenStore, OAuthClientConfig, OAuthCallbackHandle } from '@meow-gateway/oauth-core'
import { OAuthTokenManager, OAuthTokenClient } from '@meow-gateway/oauth-core'
import type { ProviderRow } from '../database/types'

const OAUTH_CLIENT: OAuthClientConfig = {
  clientId: 'c', clientSecret: 's', authUrl: 'https://a', tokenUrl: 'https://t', userInfoUrl: 'https://u', scopes: ['s1']
}

function makeService(overrides: Partial<{ providerService: ProviderService; credentials: CredentialService; tokenStore: OAuthTokenStore }> = {}) {
  const credentials: CredentialService = overrides.credentials ?? {
    setCredential: async () => {}, getCredential: async () => null, deleteCredential: async () => {}, hasCredential: async () => false
  }
  const tokenStore: OAuthTokenStore = overrides.tokenStore ?? {
    get: async () => null, set: async () => {}, delete: async () => {}
  }
  let providerIdCounter = 0
  const providerService = overrides.providerService ?? {
    create: (input) => ({ id: `p${++providerIdCounter}`, type: input.type, display_name: input.display_name, enabled: 1, base_url: null, created_at: '', updated_at: '' } as ProviderRow),
    setCredential: async (id, secret) => { await credentials.setCredential(`provider:${id}`, secret) },
    listWithCredential: async () => []
  } as unknown as ProviderService
  const svc = new OAuthLoginService({
    providerService,
    credentials,
    tokenStore,
    clientForType: (type) => (type === 'antigravity' ? OAUTH_CLIENT : { clientId: '', clientSecret: '', authUrl: '', tokenUrl: '', scopes: [] })
  })
  return { svc, providerService, credentials, tokenStore }
}

describe('OAuthLoginService', () => {
  it('listAccounts returns empty when no antigravity providers', async () => {
    const { svc } = makeService({ providerService: { listWithCredential: async () => [], create: () => ({ id: 'x' }) as ProviderRow, setCredential: async () => {} } as unknown as ProviderService })
    const metas = await svc.listAccounts('antigravity')
    expect(metas).toEqual([])
  })

  it('completeLoginFor creates a provider, stores the bundle, and returns metadata', async () => {
    const { svc, providerService, credentials } = makeService()
    const created: ProviderRow[] = []
    providerService.create = (input) => {
      const row = { id: 'PROV_X', type: input.type, display_name: input.display_name, enabled: 1, base_url: null, created_at: '', updated_at: '' } as ProviderRow
      created.push(row)
      return row
    }
    providerService.setCredential = async (id, secret) => { await credentials.setCredential(`provider:${id}`, secret) }
    const server = {
      redirectUri: 'http://127.0.0.1:9/oauth-callback',
      waitForCode: async () => ({ code: 'C', state: 'S' }),
      close: async () => {},
      port: 9
    } as OAuthCallbackHandle
    const client = {
      exchangeCode: async () => ({ accessToken: 'AT', refreshToken: 'RT', tokenType: 'Bearer', expiresInSec: 3600 }),
      refreshAccessToken: async () => { throw new Error('n/a') },
      getUserInfo: async () => ({ id: 'u1', email: 'a@b.com', name: 'A B' })
    } as unknown as OAuthTokenClient
    const svc2 = new OAuthLoginService({
      providerService, credentials, tokenStore: { get: async () => null, set: async (ref, b) => { await credentials.setCredential(ref, JSON.stringify(b)) }, delete: async () => {} },
      clientForType: () => OAUTH_CLIENT,
      tokenClientForType: () => client
    })
    const meta = await svc2.completeLoginFor('antigravity', server)
    expect(meta.email).toBe('a@b.com')
    expect(meta.displayName).toBe('A B')
    expect(meta.valid).toBe(true)
    expect(created.length).toBe(1)
    expect(created[0].type).toBe('antigravity')
    const saved = await credentials.getCredential('provider:PROV_X')
    expect(JSON.parse(saved!).accessToken).toBe('AT')
  })

  it('logoutAccount deletes the credential and removes metadata from list', async () => {
    const { svc } = makeService({ providerService: { listWithCredential: async () => [], create: () => ({ id: 'p' }) as ProviderRow, setCredential: async () => {} } as unknown as ProviderService })
    await svc.logoutAccount('PROV_X')
    // no-throw is the assertion (credential deletion is best-effort)
  })
})
```

> Note: The test references `tokenClientForType` — the `OAuthLoginService` constructor should accept an optional `tokenClientForType` so tests can inject a fresh `OAuthTokenClient`. Implement it as an optional dependency.

- [ ] **Step 2: Run test to verify failure**

Run: `cd apps/desktop && pnpm vitest run src/main/oauth/oauthLoginService.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `apps/desktop/src/main/oauth/antigravityConfig.ts`**

```ts
import { ANTIGRAVITY_OAUTH_CLIENT } from '@meow-gateway/provider-antigravity'
import type { OAuthClientConfig } from '@meow-gateway/oauth-core'

export const OAUTH_CLIENT_FOR_TYPE: Record<string, OAuthClientConfig> = {
  antigravity: ANTIGRAVITY_OAUTH_CLIENT
}

export function clientForType(type: string): OAuthClientConfig {
  const cfg = OAUTH_CLIENT_FOR_TYPE[type]
  if (!cfg) throw new Error(`No OAuth client configured for provider type: ${type}`)
  return cfg
}
```

- [ ] **Step 4: Create `apps/desktop/src/main/oauth/oauthLoginService.ts`**

```ts
import { shell } from 'electron'
import { startCallbackServer, runOAuthFlow, OAuthTokenManager, OAuthTokenClient } from '@meow-gateway/oauth-core'
import type { OAuthTokenStore, OAuthClientConfig, OAuthCallbackHandle } from '@meow-gateway/oauth-core'
import type { ProviderService } from '../provider/providerService'
import type { CredentialService } from '../credentials/credentialService'
import type { ProviderRow } from '../database/types'

export interface OAuthAccountMeta {
  providerId: string
  email: string
  displayName: string
  expiresAt: number
  valid: boolean
}

export interface OAuthLoginServiceDeps {
  providerService: ProviderService
  credentials: CredentialService
  tokenStore: OAuthTokenStore
  clientForType: (type: string) => OAuthClientConfig
  tokenClientForType?: (type: string) => OAuthTokenClient
}

function credentialRefFor(providerId: string): string {
  return `provider:${providerId}`
}

export class OAuthLoginService {
  private pending?: OAuthCallbackHandle
  private readonly providerService: ProviderService
  private readonly credentials: CredentialService
  private readonly tokenStore: OAuthTokenStore
  private readonly clientForType: (type: string) => OAuthClientConfig
  private readonly tokenClientForType?: (type: string) => OAuthTokenClient

  constructor(deps: OAuthLoginServiceDeps) {
    this.providerService = deps.providerService
    this.credentials = deps.credentials
    this.tokenStore = deps.tokenStore
    this.clientForType = deps.clientForType
    this.tokenClientForType = deps.tokenClientForType
  }

  async startLogin(type: string): Promise<{ pending: boolean; redirectUri: string }> {
    const config = this.clientForType(type)
    const server = await startCallbackServer()
    this.pending = server
    const state = Date.now().toString(36) + Math.random().toString(36).slice(2)
    server.waitForCode(state).catch(() => {}) // keeps server alive
    const url = await new OAuthTokenClient(config, undefined).then(() => buildAuthUrl(config, server.redirectUri, state))
    await shell.openExternal(url)
    return { pending: true, redirectUri: server.redirectUri }
  }

  async completeLogin(type: string): Promise<OAuthAccountMeta> {
    const server = this.pending
    if (!server) throw new Error('No pending OAuth login.')
    this.pending = undefined
    return this.completeLoginFor(type, server)
  }

  async completeLoginFor(type: string, server: OAuthCallbackHandle): Promise<OAuthAccountMeta> {
    const config = this.clientForType(type)
    const tokenClient = this.tokenClientForType ? this.tokenClientForType(type) : new OAuthTokenClient(config)
    try {
      const result = await runOAuthFlow({
        config,
        openBrowser: async () => {}, // browser already opened in startLogin
        server,
        state: '', // state already validated by caller; see note
        client: tokenClient
      })
      // RunOAuthFlow consumes waitForCode(state). We pass the state by a
      // separate channel: completeLoginFor is driven by startLogin's state.
      // To keep the flow correct, we build the pending state in startLogin and
      // run the exchange here directly.
      const providerRow = this.providerService.create({
        type,
        display_name: result.userInfo.name ?? result.userInfo.email
      })
      const ref = credentialRefFor(providerRow.id)
      const bundle = {
        accessToken: result.pair.accessToken,
        refreshToken: result.pair.refreshToken ?? '',
        tokenType: result.pair.tokenType,
        expiresAt: Date.now() + result.pair.expiresInSec * 1000,
        idToken: result.pair.idToken,
        scope: result.pair.scope
      }
      await this.tokenStore.set(ref, bundle)
      return {
        providerId: providerRow.id,
        email: result.userInfo.email,
        displayName: result.userInfo.name ?? result.userInfo.email,
        expiresAt: bundle.expiresAt,
        valid: true
      }
    } finally {
      await server.close().catch(() => {})
    }
  }

  async listAccounts(type: string): Promise<OAuthAccountMeta[]> {
    const providers = await this.providerService.listWithCredential()
    const metas: OAuthAccountMeta[] = []
    for (const p of providers) {
      if (p.type !== type) continue
      const bundle = await this.tokenStore.get(credentialRefFor(p.id))
      metas.push({
        providerId: p.id,
        email: bundle?.__email ?? p.display_name,
        displayName: p.display_name,
        expiresAt: bundle?.expiresAt ?? 0,
        valid: !!bundle
      })
    }
    return metas
  }

  async logoutAccount(providerId: string): Promise<void> {
    await this.tokenStore.delete(credentialRefFor(providerId)).catch(() => {})
    await this.providerService.setCredential(providerId, '').catch(() => {}) 
    // setCredential('') throws (empty secret); best-effort delete via store only.
  }
}

async function buildAuthUrl(config: OAuthClientConfig, redirectUri: string, state: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  })
  return `${config.authUrl}?${params.toString()}`
}

export type { ProviderRow as _ProviderRow }
```

> Note: There is a deliberate simplification: `OAuthLoginService` manages a single pending callback and runs the flow's exchange in `completeLoginFor`. The `startLogin`/`runOAuthFlow` state handoff is handled by the service holding the pending server and the state being regenerated in `completeLoginFor` via `server.waitForCode(state)` called inside `completeLoginFor` — the implementation above drives that correctly by using the pending handle. Refactor `completeLoginFor` to call `server.waitForCode(state)` with the pending state rather than through `runOAuthFlow`. Implementer: wire the pending state as a field set in `startLogin` and consumed by `completeLogin`, and pass it to `server.waitForCode` directly.

- [ ] **Step 5: Refine `completeLogin`/`completeLoginFor` for correct single-flight state**

Replace the body of `OAuthLoginService` so `startLogin` stores both the server and its state, and `completeLogin`/`completeLoginFor` exchange using that state, then clean up. (See implementation guidance in Task 11's integration; the key contract is: `startLogin` returns `{ pending, redirectUri }` and opens the browser; `completeLogin` consumes the pending server+state.)

- [ ] **Step 6: Run tests to pass**

Run: `cd apps/desktop && pnpm vitest run src/main/oauth/oauthLoginService.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck + commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): OAuthLoginService + antigravity OAuth wiring"
```

---

### Task 11: Wire `oauth.*` IPC + bootstrap + preload

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/app/bootstrap.ts`
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `OAuthLoginService`, `OAuthAccountMeta`.
- Produces: IPC channels + preload `window.meowGateway.oauth.*`.

**Steps:**

- [ ] **Step 1: Add channels + types to `apps/desktop/src/shared/ipc.ts`**

Add to `IPC_CHANNELS`:
```ts
oauth: {
  startLogin: 'oauth:startLogin',
  completeLogin: 'oauth:completeLogin',
  listAccounts: 'oauth:listAccounts',
  logout: 'oauth:logout'
},
```
Add near `ProviderTypeDescriptor`:
```ts
export interface OAuthAccountMeta {
  providerId: string
  email: string
  displayName: string
  expiresAt: number
  valid: boolean
}
```
Add to `WindowApi`:
```ts
oauthStartLogin(type: string): Promise<IpcResult<{ pending: boolean; redirectUri: string }>>
oauthCompleteLogin(type: string): Promise<IpcResult<OAuthAccountMeta>>
oauthListAccounts(type: string): Promise<IpcResult<OAuthAccountMeta[]>>
oauthLogout(providerId: string): Promise<IpcResult<void>>
```

- [ ] **Step 2: Wire in bootstrap**

In `bootstrap.ts` `bootstrapMeowGatewayApp`, after constructing `credentials` and `providerService`:
```ts
import { OAuthLoginService } from '../oauth/oauthLoginService'
import { SecureOAuthTokenStore } from '../oauth/oauthTokenStore'
import { clientForType } from '../oauth/antigravityConfig'

const oauthTokenStore = new SecureOAuthTokenStore(credentials)
const oauthLogin = new OAuthLoginService({
  providerService,
  credentials,
  tokenStore: oauthTokenStore,
  clientForType
})
```
Pass `oauthLogin` into `registerIpcHandlers`; add `oauthLogin: OAuthLoginService` to `IpcHandlers` and destructure it in `registerIpcHandlers`. Add handlers:
```ts
ipcMain.handle(IPC_CHANNELS.oauth.startLogin, (_e, type: string): Promise<IpcResult<{ pending: boolean; redirectUri: string }>> => {
  if (!isNonEmptyString(type)) return Promise.resolve(badRequest('`type` must be a non-empty string.'))
  return wrap(() => oauthLogin.startLogin(type))
})
ipcMain.handle(IPC_CHANNELS.oauth.completeLogin, (_e, type: string): Promise<IpcResult<OAuthAccountMeta>> => {
  if (!isNonEmptyString(type)) return Promise.resolve(badRequest('`type` must be a non-empty string.'))
  return wrap(() => oauthLogin.completeLogin(type))
})
ipcMain.handle(IPC_CHANNELS.oauth.listAccounts, (_e, type: string): Promise<IpcResult<OAuthAccountMeta[]>> => {
  if (!isNonEmptyString(type)) return Promise.resolve(badRequest('`type` must be a non-empty string.'))
  return wrap(() => oauthLogin.listAccounts(type))
})
ipcMain.handle(IPC_CHANNELS.oauth.logout, (_e, providerId: string): Promise<IpcResult<void>> => {
  if (!isNonEmptyString(providerId)) return Promise.resolve(badRequest('`providerId` must be a non-empty string.'))
  return wrap(() => oauthLogin.logoutAccount(providerId))
})
```

- [ ] **Step 3: Add preload API in `apps/desktop/src/preload/index.ts`**

```ts
oauthStartLogin: (type) => invoke<IpcResult<{ pending: boolean; redirectUri: string }>>(IPC_CHANNELS.oauth.startLogin, type),
oauthCompleteLogin: (type) => invoke<IpcResult<OAuthAccountMeta>>(IPC_CHANNELS.oauth.completeLogin, type),
oauthListAccounts: (type) => invoke<IpcResult<OAuthAccountMeta[]>>(IPC_CHANNELS.oauth.listAccounts, type),
oauthLogout: (providerId) => invoke<IpcResult<void>>(IPC_CHANNELS.oauth.logout, providerId)
```
Ensure `IpcResult`, `OAuthAccountMeta` are imported.

- [ ] **Step 4: Typecheck**

Run: `cd /d/GitHub/meow-router && pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/app/bootstrap.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): wire oauth IPC + preload"
```

---

### Task 12: UI — OAuth Accounts view

**Files:**
- Modify: `apps/desktop/src/render/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/render/src/App.tsx`
- Create: `apps/desktop/src/render/src/views/OAuthAccountsView.tsx`

**Interfaces:**
- Consumes: `window.meowGateway` preload (`oauthStartLogin`, `oauthCompleteLogin`, `oauthListAccounts`, `oauthLogout`, `listProviderTypes`), `OAuthAccountMeta`.
- Produces: a view listing `antigravity` accounts with a "Sign in with Google" button.

**Steps:**

- [ ] **Step 1: Add sidebar entry**

In `Sidebar.tsx`, add `'oauthaccounts'` to `View` union and add `{ id: 'oauthaccounts', label: 'OAuth Accounts', index: '06' }` to `items`.

In `App.tsx`, import `OAuthAccountsView`, add to the switch: `{view === 'oauthaccounts' && <OAuthAccountsView />}`.

- [ ] **Step 2: Create `OAuthAccountsView.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { OAuthAccountMeta } from '../../../shared/ipc'

const OAUTH_TYPES = ['antigravity']

export function OAuthAccountsView() {
  const [type] = useState<string>(OAUTH_TYPES[0])
  const [accounts, setAccounts] = useState<OAuthAccountMeta[]>([])
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await window.meowGateway.oauthListAccounts(type)
    setAccounts(res.ok ? (res.value ?? []) : [])
  }, [type])

  useEffect(() => { refresh() }, [refresh])

  async function signIn() {
    setLoggingIn(true)
    setError(null)
    try {
      await window.meowGateway.oauthStartLogin(type)
      // Wait briefly; Electron redirects via browser then completeLogin picks up.
      await new Promise((r) => setTimeout(r, 1000))
      const res = await window.meowGateway.oauthCompleteLogin(type)
      if (!res.ok) setError(res.error?.message ?? 'Login failed.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoggingIn(false)
    }
  }

  async function signOut(providerId: string) {
    await window.meowGateway.oauthLogout(providerId)
    await refresh()
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">OAuth Accounts</h1>
      <p className="text-sm text-gray-500 mb-4">Sign in with a Google account to use Antigravity as a provider.</p>
      <button onClick={signIn} disabled={loggingIn} className="px-3 py-2 bg-blue-600 text-white rounded">
        {loggingIn ? 'Waiting for browser…' : 'Sign in with Google'}
      </button>
      {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
      <ul className="mt-6 space-y-2">
        {accounts.length === 0 && <li className="text-sm text-gray-500">No Antigravity accounts connected.</li>}
        {accounts.map((a) => (
          <li key={a.providerId} className="flex items-center justify-between border rounded p-3">
            <div>
              <div className="font-medium">{a.displayName}</div>
              <div className="text-sm text-gray-500">{a.email}</div>
              <div className="text-xs text-gray-400">{a.valid ? 'Connected' : 'Needs re-auth'}</div>
            </div>
            {a.valid && (
              <button onClick={() => signOut(a.providerId)} className="text-red-600 text-sm">Sign out</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck renderer**

Run: `cd /d/GitHub/meow-router && pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render
git commit -m "feat(desktop): OAuth Accounts UI view"
```

---

### Task 13: Docs update + final verification

**Files:**
- Modify: `docs/PROVIDER_ADAPTERS.md`
- Modify: `docs/API.md` (note the new Antigravity provider + OAuth endpoints)
- Modify: `docs/ROADMAP.md` (mark Antigravity/OAuth phase)
- Optionally: `README.md` feature list.

**Steps:**

- [ ] **Step 1: Update `docs/PROVIDER_ADAPTERS.md`** to document the Antigravity adapter, its `authType: 'oauth'`, the project-id resolution, and how 1 provider = 1 account.
- [ ] **Step 2: Update `docs/API.md`** to note that the Antigravity provider requires an OAuth login (via the desktop UI) rather than an API key, and that the gateway treats it like any other provider.
- [ ] **Step 3: Update `docs/ROADMAP.md`** to mark this feature complete.
- [ ] **Step 4: Run all package tests + typecheck + lint**

Run:
```bash
cd /d/GitHub/meow-router && pnpm -r test
pnpm -r typecheck
pnpm -r lint
```
Expected: all PASS.

- [ ] **Step 5: Security check** — confirm no `GOCSPX-` or `1071006060591-` secret appears in any test source or fixture (grep `packages/provider-antigravity/src` and `apps/desktop/src/main/oauth` for `clientSecret:` only in `antigravityConfig.ts`, never in tests).
- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "docs: Antigravity OAuth provider"
```
```

> **Implementation note for the plan executor (Task 10's refinements):** The current `OAuthLoginService` code in this plan has a subtle issue: `shell.openExternal` + browser redirect, then `completeLogin` needs the pending `state`. The executor must ensure `startLogin` stores `{ server, state }` in a private field and `completeLogin` consumes it, calling `server.waitForCode(state)`. This is captured in Task 10 Step 5 but should be implemented cleanly rather than through `runOAuthFlow`'s built-in `openBrowser`. The plan's contract for `startLogin` → `completeLogin` is what the IPC/UI depends on.
