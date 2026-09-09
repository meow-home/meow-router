# Antigravity Quota Display Implementation Plan

> **For agentic workers:** REQUIRED reading before starting:
> 1. `docs/superpowers/specs/2026-09-09-antigravity-quota-display-design.md` — the design spec
> 2. `AGENTS.md` — engineering rules (strict TS, no secrets in logs, tests for every feature)
> 3. `apps/desktop/src/main/app/bootstrap.ts` — see how services are wired and IPC handlers registered
>
> **Context:** This plan implements a feature to display 5-hour and weekly quota limits for Antigravity OAuth accounts on their OAuth cards in the Meow Gateway desktop app. The quota data comes from two Cloud Code Assist API endpoints. The reference implementation is in `cockpit-tools` (Rust + React), but we port only the parsing logic to TypeScript.

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `packages/provider-antigravity/src/quotaParser.ts` | Pure functions: parse raw API responses into `QuotaItem[]`. Model name matching logic. Gemini 5h override. |
| `packages/provider-antigravity/src/quotaParser.test.ts` | Unit tests for the parser. |
| `apps/desktop/src/main/quota/quotaService.ts` | `QuotaService` class: polling, caching, account discovery, error isolation. |
| `apps/desktop/src/main/quota/quotaService.test.ts` | Unit tests for the service. |
| `apps/desktop/src/render/src/components/QuotaBar.tsx` | Reusable progress bar component: label, colored bar, percentage, reset time. |
| `apps/desktop/src/render/src/components/QuotaBar.test.tsx` | Component tests. |

### Modified Files

| File | Changes |
|------|---------|
| `packages/provider-antigravity/src/adapter.ts` | Add `getQuota()` method + `RawQuotaResponse` type. Add `QUOTA_SUMMARY_PATH` constant. |
| `packages/provider-antigravity/src/adapter.test.ts` | Add tests for `getQuota()`. |
| `packages/provider-antigravity/src/index.ts` | Re-export `RawQuotaResponse`, `parseQuotaResponse`, `QuotaItem`. |
| `apps/desktop/src/shared/ipc.ts` | Add `QuotaItem`, `AntigravityQuotaData` types. Add `quota` IPC channels. Add `quotaList`, `quotaRefresh` to `WindowApi`. |
| `apps/desktop/src/main/app/bootstrap.ts` | Import + instantiate `QuotaService`. Add to `IpcHandlers`. Register `quota:list` and `quota:refresh` handlers. Start polling. |
| `apps/desktop/src/preload/index.ts` | Import quota types. Add `quotaList`, `quotaRefresh` to the API bridge. |
| `apps/desktop/src/render/src/test/setup.ts` | Add `quotaList`, `quotaRefresh` mocks. |
| `apps/desktop/src/render/src/views/OAuthAccountsView.tsx` | Fetch quota data. Render `QuotaBar` components per account card. Add refresh button. Auto-poll. |
| `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx` | Add tests for quota rendering, refresh button, error state. |
| `apps/desktop/src/render/src/styles/meow.css` | Add `.quota-bar`, `.quota-bar-track`, `.quota-bar-fill`, `.quota-bar-fill--ok/warn/fault`, `.quota-bar-meta`, `.oauth-quota-section` styles. |

## Tasks

### Task 1: Quota Parser (pure functions + tests)

**Goal:** Create the pure parsing logic that converts raw API responses into `QuotaItem[]`.

**File:** `packages/provider-antigravity/src/quotaParser.ts`

```typescript
// The types that cross the IPC boundary. Defined here in the provider package
// so the parser is self-contained, then re-exported from the package index.
export interface QuotaItem {
  key: string
  label: string
  percentage: number
  resetTime: string
}

// Raw shape returned by AntigravityAdapter.getQuota(). Mirrors the Cloud Code
// Assist API responses from fetchAvailableModels + retrieveUserQuotaSummary.
export interface RawQuotaResponse {
  models: Record<
    string,
    {
      displayName?: string
      quotaInfo?: {
        remainingFraction?: number
        resetTime?: string
      }
    }
  >
  quotaSummary?: {
    groups?: Array<{
      buckets?: Array<{
        bucketId?: string
        displayName?: string
        remainingFraction?: number
        resetTime?: string
      }>
    }>
  }
  tier?: string
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function fractionToPercent(fraction: number | undefined): number {
  if (typeof fraction !== 'number' || isNaN(fraction)) return 0
  return clampPercent(fraction * 100)
}

// Label map for known bucket ids / model name keys.
const LABELS: Record<string, string> = {
  'claude:5h': 'Claude (5h)',
  'claude:weekly': 'Claude (Weekly)',
  'gemini:5h': 'Gemini (5h)',
  'gemini:weekly': 'Gemini (Weekly)',
}

function labelFor(key: string): string {
  return LABELS[key] ?? key
}

// Match a model name to a quota key. Priority order:
//   1. Exact bucket id match ('3p-5h', 'claude:5h', 'gemini-5h', etc.)
//   2. Fuzzy model name match (contains 'claude'/'gemini' + 'high'/'low'/'flash')
//
// Returns one of: 'claude:5h' | 'claude:weekly' | 'gemini:5h' | 'gemini:weekly' | null
function matchBucketKey(id: string): string | null {
  const lower = id.toLowerCase()

  // Exact bucket-id matches (from retrieveUserQuotaSummary)
  if (lower === '3p-5h' || lower === 'claude:5h') return 'claude:5h'
  if (lower === '3p-weekly' || lower === 'claude:weekly') return 'claude:weekly'
  if (lower === 'gemini-5h' || lower === 'gemini:5h') return 'gemini:5h'
  if (lower === 'gemini-weekly' || lower === 'gemini:weekly') return 'gemini:weekly'

  // Fuzzy model-name matches (from fetchAvailableModels fallback)
  const isClaude = lower.includes('claude')
  const isGemini = lower.includes('gemini')
  if (!isClaude && !isGemini) return null

  const isLow = lower.includes('low')
  const isHigh = lower.includes('high')
  const isFlash = lower.includes('flash')

  if (isClaude) {
    // 'low' tier → weekly; everything else → 5h
    return isLow ? 'claude:weekly' : 'claude:5h'
  }
  if (isGemini) {
    // 'low' tier → weekly; 'high' or 'flash' → 5h; default → 5h
    return isLow ? 'gemini:weekly' : 'gemini:5h'
  }

  return null
}

// If a Gemini 5h reset time is more than 5 hours in the future, the weekly
// limit is capping the 5h limit. Override to 100% remaining and clear reset
// time. This mirrors cockpit-tools behavior.
function applyGemini5hOverride(items: QuotaItem[]): void {
  const gemini5h = items.find((i) => i.key === 'gemini:5h')
  if (!gemini5h || !gemini5h.resetTime) return
  const resetMs = Date.parse(gemini5h.resetTime)
  if (isNaN(resetMs)) return
  if (resetMs - Date.now() > FIVE_HOURS_MS) {
    gemini5h.percentage = 100
    gemini5h.resetTime = ''
  }
}

export function parseQuotaResponse(raw: RawQuotaResponse): QuotaItem[] {
  const items = new Map<string, QuotaItem>()

  // 1. Parse quota summary buckets (preferred source)
  if (raw.quotaSummary?.groups) {
    for (const group of raw.quotaSummary.groups) {
      if (!group.buckets) continue
      for (const bucket of group.buckets) {
        const key = matchBucketKey(bucket.bucketId ?? '')
        if (!key) continue
        // Don't overwrite if already set (first group wins)
        if (items.has(key)) continue
        items.set(key, {
          key,
          label: bucket.displayName || labelFor(key),
          percentage: fractionToPercent(bucket.remainingFraction),
          resetTime: bucket.resetTime ?? '',
        })
      }
    }
  }

  // 2. Fall back to fetchAvailableModels model-level quota
  for (const [modelName, info] of Object.entries(raw.models)) {
    if (!info.quotaInfo) continue
    const key = matchBucketKey(modelName)
    if (!key) continue
    if (items.has(key)) continue
    items.set(key, {
      key,
      label: info.displayName || labelFor(key),
      percentage: fractionToPercent(info.quotaInfo.remainingFraction),
      resetTime: info.quotaInfo.resetTime ?? '',
    })
  }

  const result = Array.from(items.values())
  applyGemini5hOverride(result)
  return result
}
```

#### Steps

1. **Write `quotaParser.test.ts`** with these test cases:
   - Parses `retrieveUserQuotaSummary` buckets: `3p-5h` → `claude:5h`, `3p-weekly` → `claude:weekly`, `gemini-5h` → `gemini:5h`, `gemini-weekly` → `gemini:weekly`
   - Falls back to `fetchAvailableModels` when no summary: model name `claude-3-5-sonnet-high` → `claude:5h`, `claude-3-5-sonnet-low` → `claude:weekly`, `gemini-2.5-flash` → `gemini:5h`, `gemini-2.5-pro-low` → `gemini:weekly`
   - Summary takes priority over model name match (same key)
   - Empty models + empty summary → `[]`
   - Missing `quotaInfo` on a model → that model is skipped
   - `remainingFraction: undefined` → percentage `0`
   - `remainingFraction: 1.5` → percentage `100` (clamped)
   - `remainingFraction: -0.1` → percentage `0` (clamped)
   - Gemini 5h override: reset time >5h in future → percentage `100`, resetTime `''`
   - Gemini 5h override: reset time <5h in future → unchanged
   - Unknown bucket id (not claude/gemini) → skipped
   - `displayName` from bucket is used as label when present; falls back to `labelFor(key)` when absent

2. **Run the test** — `cd packages/provider-antigravity && pnpm test -- quotaParser` — confirm all tests fail (file doesn't exist yet or has no implementation).

3. **Create `quotaParser.ts`** with the code above.

4. **Run the test** — confirm all tests pass.

5. **Run typecheck** — `cd packages/provider-antigravity && pnpm typecheck` — confirm no errors.

6. **Run lint** — `cd packages/provider-antigravity && pnpm lint` — confirm no errors.

7. **Commit:** `feat(antigravity): add quota parser with model matching logic`

---

### Task 2: Adapter `getQuota()` method + tests

**Goal:** Add `getQuota()` to `AntigravityAdapter` that calls both Cloud Code Assist endpoints and returns `RawQuotaResponse`.

**File:** `packages/provider-antigravity/src/adapter.ts`

Add these additions to the existing file:

1. Add a new constant near `FETCH_MODELS_PATH`:
```typescript
const QUOTA_SUMMARY_PATH = '/v1internal:retrieveUserQuotaSummary'
```

2. Add the `RawQuotaResponse` import at the top:
```typescript
import type { RawQuotaResponse, QuotaItem } from './quotaParser'
```

3. Add the `getQuota` method to `AntigravityAdapter` class (after `getModels`, before `baseUrlsToTry`):

```typescript
/**
 * Fetch quota data from Cloud Code Assist. Calls two endpoints:
 *   1. fetchAvailableModels — model-level quota (fallback)
 *   2. retrieveUserQuotaSummary — bucket-level 5h/weekly quota (preferred)
 *
 * Returns raw JSON for the QuotaService to parse. Never throws on partial
 * failure: if one endpoint fails, returns whatever data the other provided.
 * If both fail, throws ProviderError.
 */
async getQuota(ctx: ProviderContext): Promise<RawQuotaResponse> {
  this.assertEndpointSafe(ctx)
  const { accessToken, bundle } = await this.resolveAuth(ctx)
  const projectId = await this.resolveProject(ctx, accessToken, bundle)

  const base = this.baseUrlsToTry(ctx)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity',
    'x-goog-api-client': 'gl-node/18'
  }

  let models: RawQuotaResponse['models'] = {}
  let quotaSummary: RawQuotaResponse['quotaSummary'] | undefined
  let tier: string | undefined

  // 1. fetchAvailableModels — model-level quota
  for (const b of base) {
    try {
      const res = await this.fetcher(joinUrl(b, FETCH_MODELS_PATH), {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: projectId }),
        signal: ctx.signal
      })
      if (res.ok) {
        const data = (await res.json()) as {
          payload?: { models?: Record<string, unknown> }
          models?: Record<string, unknown>
        }
        const map = data.payload?.models ?? data.models ?? {}
        models = map as RawQuotaResponse['models']
        break
      }
    } catch {
      // try next base url
    }
  }

  // 2. retrieveUserQuotaSummary — bucket-level 5h/weekly quota
  for (const b of base) {
    try {
      const res = await this.fetcher(joinUrl(b, QUOTA_SUMMARY_PATH), {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: projectId }),
        signal: ctx.signal
      })
      if (res.ok) {
        quotaSummary = (await res.json()) as RawQuotaResponse['quotaSummary']
        break
      }
    } catch {
      // try next base url
    }
  }

  if (Object.keys(models).length === 0 && !quotaSummary) {
    throw new ProviderError({
      type: 'PROVIDER_UNAVAILABLE',
      message: 'Quota fetch failed: both endpoints returned no data.',
      retryable: true
    })
  }

  return { models, quotaSummary, tier }
}
```

4. Update `packages/provider-antigravity/src/index.ts` to re-export:
```typescript
export { parseQuotaResponse, type RawQuotaResponse, type QuotaItem } from './quotaParser'
```

#### Steps

1. **Add tests to `adapter.test.ts`** (append new `describe` block at the end, before the closing):
   - `getQuota()` returns models + quotaSummary when both endpoints succeed
   - `getQuota()` returns models only when summary endpoint 404s
   - `getQuota()` returns summary only when models endpoint 404s
   - `getQuota()` throws `PROVIDER_UNAVAILABLE` when both endpoints fail
   - `getQuota()` resolves project id before calling quota endpoints
   - `getQuota()` tries fallback base URLs on network error
   - `getQuota()` sends Bearer auth header

   Use the existing `fetcherFor` helper and `ctx` helper from the test file. Add a `quotaFetcherFor` helper:
   ```typescript
   function quotaFetcherFor(modelsResponse: unknown, summaryResponse: unknown, modelStatus = 200, summaryStatus = 200): Fetcher {
     return fetcherFor(async (url) => {
       if (url.includes('loadCodeAssist')) return { ok: true, status: 200, text: JSON.stringify({ project: { id: 'proj-1' } }) }
       if (url.includes('fetchAvailableModels')) return { ok: modelStatus === 200, status: modelStatus, text: JSON.stringify(modelsResponse) }
       if (url.includes('retrieveUserQuotaSummary')) return { ok: summaryStatus === 200, status: summaryStatus, text: JSON.stringify(summaryResponse) }
       return { ok: false, status: 404, text: '' }
     })
   }
   ```

2. **Run tests** — `cd packages/provider-antigravity && pnpm test` — confirm new tests fail (method doesn't exist).

3. **Implement** `getQuota()` in `adapter.ts` and update `index.ts` exports.

4. **Run tests** — confirm all pass.

5. **Run typecheck** — `cd packages/provider-antigravity && pnpm typecheck`.

6. **Run lint** — `cd packages/provider-antigravity && pnpm lint`.

7. **Commit:** `feat(antigravity): add getQuota() adapter method for Cloud Code Assist quota API`

---

### Task 3: Shared IPC types + channels

**Goal:** Add quota types and IPC channel definitions to the shared IPC contract.

**File:** `apps/desktop/src/shared/ipc.ts`

#### Changes

1. Add the `quota` channels to `IPC_CHANNELS` (after `oauth`, before `virtualModel`):
```typescript
  quota: {
    list: 'quota:list',
    refresh: 'quota:refresh'
  },
```

2. Add two methods to the `WindowApi` interface (after `oauthLogout`, before `ping`):
```typescript
  quotaList(): Promise<AntigravityQuotaData[]>
  quotaRefresh(): Promise<AntigravityQuotaData[]>
```

3. Add the type definitions at the end of the file (before the closing, after `OAuthAccountMeta`):
```typescript
export interface QuotaItem {
  key: string
  label: string
  percentage: number
  resetTime: string
}

export interface AntigravityQuotaData {
  providerId: string
  items: QuotaItem[]
  tier: string
  lastUpdatedAt: number
  error?: string
}
```

4. Also add the re-export at the top, near the existing imports:
```typescript
import type { QuotaItem as ProviderQuotaItem } from '@meow-gateway/provider-antigravity'
```
And re-export it:
```typescript
export type { QuotaItem } from '@meow-gateway/provider-antigravity'
```
(Use the provider package's `QuotaItem` as the canonical type — the local definition above should instead just `export type { QuotaItem } from '@meow-gateway/provider-antigravity'`.)

**Wait — simplify:** Don't define `QuotaItem` locally. Just re-export from the provider package. Only define `AntigravityQuotaData` locally since it's app-specific.

Revised additions:
```typescript
// At the top with other imports:
import type { QuotaItem } from '@meow-gateway/provider-antigravity'
export type { QuotaItem } from '@meow-gateway/provider-antigravity'

// After OAuthAccountMeta:
export interface AntigravityQuotaData {
  providerId: string
  items: QuotaItem[]
  tier: string
  lastUpdatedAt: number
  error?: string
}
```

#### Steps

1. **Edit `ipc.ts`** with all the changes above.

2. **Run typecheck** — `cd apps/desktop && pnpm typecheck` — this will fail because `quotaList`/`quotaRefresh` are not yet in preload or the test mock. That's expected; proceed to Task 4.

3. **Commit:** `feat(ipc): add quota IPC channels and types`

---

### Task 4: QuotaService (main process) + tests

**Goal:** Create the `QuotaService` that polls, caches, and manages quota data for all Antigravity accounts.

**File:** `apps/desktop/src/main/quota/quotaService.ts`

```typescript
import type { AntigravityAdapter } from '@meow-gateway/provider-antigravity'
import type { RawQuotaResponse, QuotaItem } from '@meow-gateway/provider-antigravity'
import { parseQuotaResponse } from '@meow-gateway/provider-antigravity'
import type { OAuthTokenManager } from '@meow-gateway/oauth-core'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { AntigravityQuotaData } from '../../shared/ipc'

export interface QuotaServiceDeps {
  adapter: AntigravityAdapter
  tokenManager: OAuthTokenManager
  providerRepo: ProviderRepository
  /** Credential service for resolving OAuth token bundles. */
  getCredential: (ref: string) => Promise<string>
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
  pollIntervalMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 60_000

export class QuotaService {
  private readonly cache = new Map<string, AntigravityQuotaData>()
  private readonly adapter: AntigravityAdapter
  private readonly tokenManager: OAuthTokenManager
  private readonly providerRepo: ProviderRepository
  private readonly getCredential: (ref: string) => Promise<string>
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: QuotaServiceDeps) {
    this.adapter = deps.adapter
    this.tokenManager = deps.tokenManager
    this.providerRepo = deps.providerRepo
    this.getCredential = deps.getCredential
    this.logger = deps.logger ?? console
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  /** Return cached quota data for all Antigravity accounts. */
  getAll(): AntigravityQuotaData[] {
    return Array.from(this.cache.values())
  }

  /** Return cached quota data for one account, or undefined. */
  getByProvider(providerId: string): AntigravityQuotaData | undefined {
    return this.cache.get(providerId)
  }

  /** Fetch quota for all Antigravity accounts, update cache. */
  async refreshAll(): Promise<AntigravityQuotaData[]> {
    const providers = this.providerRepo.list().filter((p) => p.type === 'antigravity')
    // Fetch all in parallel — errors are isolated per account.
    await Promise.all(
      providers.map((p) => this.refreshProvider(p.id).catch(() => {}))
    )
    return this.getAll()
  }

  /** Fetch quota for one account, update cache. */
  async refreshProvider(providerId: string): Promise<AntigravityQuotaData> {
    const credentialRef = `provider:${providerId}`
    try {
      const credential = await this.getCredential(credentialRef)
      const raw = await this.adapter.getQuota({
        credentialRef,
        credential,
        signal: new AbortController().signal,
        requestId: `quota-${providerId}-${Date.now()}`
      })
      const items: QuotaItem[] = parseQuotaResponse(raw)
      const data: AntigravityQuotaData = {
        providerId,
        items,
        tier: raw.tier ?? '',
        lastUpdatedAt: Date.now()
      }
      this.cache.set(providerId, data)
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`[quota] fetch failed for ${providerId}: ${message}`)
      // Preserve old items if we have them, just update error + timestamp
      const existing = this.cache.get(providerId)
      const data: AntigravityQuotaData = {
        providerId,
        items: existing?.items ?? [],
        tier: existing?.tier ?? '',
        lastUpdatedAt: existing?.lastUpdatedAt ?? Date.now(),
        error: message
      }
      this.cache.set(providerId, data)
      return data
    }
  }

  /** Start polling. Safe to call multiple times. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.refreshAll().catch((err) => {
        this.logger.warn(`[quota] poll cycle failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, this.pollIntervalMs)
    // Fetch immediately on start
    this.refreshAll().catch(() => {})
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
```

#### Steps

1. **Write `quotaService.test.ts`** with these test cases:
   - `getAll()` returns empty array when no accounts cached
   - `refreshAll()` filters providers by type `'antigravity'`, skips others
   - `refreshAll()` fetches quota for each Antigravity provider, caches results
   - `refreshAll()` isolates errors: if one account fails, others still succeed
   - `refreshProvider()` caches successful result with `items`, `tier`, `lastUpdatedAt`
   - `refreshProvider()` on error: sets `error` field, preserves old `items` if cached
   - `refreshProvider()` on error with no prior cache: `items: []`
   - `start()` calls `refreshAll()` immediately and sets an interval
   - `stop()` clears the interval
   - `start()` called twice doesn't create duplicate intervals
   - Use a mock `ProviderRepository` (in-memory list), mock `AntigravityAdapter` (with `getQuota` returning a `RawQuotaResponse`), mock `getCredential` (returns JSON string)

   Mock setup pattern:
   ```typescript
   class MockProviderRepo {
     private rows: ProviderRow[]
     constructor(rows: ProviderRow[]) { this.rows = rows }
     list() { return this.rows }
   }
   
   const mockAdapter = {
     id: 'antigravity',
     getQuota: vi.fn().mockResolvedValue({ models: {}, quotaSummary: { groups: [{ buckets: [{ bucketId: '3p-5h', remainingFraction: 0.65, resetTime: '2026-09-09T12:00:00Z' }] }] } })
   }
   ```

   **Important:** Use `vi.useFakeTimers()` for interval tests and `vi.advanceTimersByTime()` to trigger polling.

2. **Run tests** — `cd apps/desktop && pnpm test -- quotaService` — confirm they fail.

3. **Create `quotaService.ts`** with the code above.

4. **Run tests** — confirm all pass.

5. **Run typecheck** — `cd apps/desktop && pnpm typecheck`.

6. **Commit:** `feat(main): add QuotaService with polling, caching, and error isolation`

---

### Task 5: Wire QuotaService into bootstrap + IPC handlers + preload

**Goal:** Connect the QuotaService in the main process bootstrap, register IPC handlers, and expose them via preload.

**Files:** `apps/desktop/src/main/app/bootstrap.ts`, `apps/desktop/src/preload/index.ts`

#### bootstrap.ts changes

1. Add import at the top (after the OAuthLoginService import):
```typescript
import { QuotaService } from '../quota/quotaService'
import type { AntigravityQuotaData } from '../../shared/ipc'
```

2. After the `registry.register(createAntigravityAdapter(...))` line and before `ensureGatewayKey`, add:
```typescript
  const quotaService = new QuotaService({
    adapter: registry.get('antigravity') as AntigravityAdapter,
    tokenManager: oauthManager,
    providerRepo,
    getCredential: (ref) => credentials.getCredential(ref),
    logger: console
  })
  quotaService.start()
```

   **Note:** You need to import `AntigravityAdapter` type at the top:
   ```typescript
   import { createAntigravityAdapter, type AntigravityAdapter } from '@meow-gateway/provider-antigravity'
   ```
   And `registry.get()` returns `ProviderAdapter | undefined`; cast to `AntigravityAdapter`. Check that `ProviderRegistry` has a `get(id)` method — if it doesn't, use the instance created by `createAntigravityAdapter` directly instead. **Investigate this before implementing.**

   **Simpler approach:** Capture the adapter instance in a variable before registering:
   ```typescript
   const antigravityAdapter = createAntigravityAdapter('antigravity', { tokenManager: oauthManager })
   registry.register(antigravityAdapter)
   const quotaService = new QuotaService({
     adapter: antigravityAdapter,
     tokenManager: oauthManager,
     providerRepo,
     getCredential: (ref) => credentials.getCredential(ref),
     logger: console
   })
   quotaService.start()
   ```

3. Add `quotaService` to the `IpcHandlers` interface:
```typescript
  quotaService: QuotaService
```

4. Pass `quotaService` in the `registerIpcHandlers({...})` call.

5. Destructure in `registerIpcHandlers`:
```typescript
  const { ..., quotaService } = handlers
```

6. Add IPC handlers (after the OAuth handlers, before Usage):
```typescript
  // --- Quota ----------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.quota.list, async (): Promise<IpcResult<AntigravityQuotaData[]>> => {
    return wrap(() => quotaService.getAll())
  })

  ipcMain.handle(IPC_CHANNELS.quota.refresh, async (): Promise<IpcResult<AntigravityQuotaData[]>> => {
    return wrap(() => quotaService.refreshAll())
  })
```

7. In the `stop()` method of the returned `MeowGatewayApp`, add `quotaService.stop()`:
```typescript
    async stop() {
      quotaService.stop()
      await gateway.stop()
      closeDatabase(db)
    }
```

#### preload/index.ts changes

1. Add import for the new types (at the top with other type imports):
```typescript
import type { AntigravityQuotaData } from '../shared/ipc'
```

2. Add to the `api` object (after `oauthLogout`, before `ping`):
```typescript
  quotaList: () => invoke<AntigravityQuotaData[]>(IPC_CHANNELS.quota.list),
  quotaRefresh: () => invoke<AntigravityQuotaData[]>(IPC_CHANNELS.quota.refresh),
```

#### Steps

1. **Edit `bootstrap.ts`** — add import, capture adapter, create QuotaService, add to IpcHandlers, register handlers, stop on shutdown.

2. **Edit `preload/index.ts`** — add types and API methods.

3. **Run typecheck** — `cd apps/desktop && pnpm typecheck` — should pass now that preload implements the new WindowApi methods.

4. **Run existing tests** — `cd apps/desktop && pnpm test` — confirm nothing broke. The bootstrap test may need updating if it checks for specific service count.

5. **Commit:** `feat(main): wire QuotaService into bootstrap, IPC handlers, and preload`

---

### Task 6: QuotaBar component + tests

**Goal:** Create a reusable progress bar component for displaying a single quota item.

**File:** `apps/desktop/src/render/src/components/QuotaBar.tsx`

```tsx
import type { QuotaItem } from '@meow-gateway/provider-antigravity'

function quotaTone(percentage: number): 'ok' | 'warn' | 'fault' {
  if (percentage <= 10) return 'fault'
  if (percentage <= 30) return 'warn'
  return 'ok'
}

function formatResetTime(resetTime: string): string {
  if (!resetTime) return ''
  const ms = Date.parse(resetTime)
  if (isNaN(ms)) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return 'resetting…'
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  if (days > 0) return `~${days}d ${remHours}h`
  return `~${hours}h`
}

export function QuotaBar({ item }: { item: QuotaItem }) {
  const tone = quotaTone(item.percentage)
  const resetLabel = formatResetTime(item.resetTime)
  return (
    <div className="quota-bar">
      <div className="quota-bar-head">
        <span className="quota-bar-label">{item.label}</span>
        <span className={`quota-bar-pct quota-bar-pct--${tone}`}>{item.percentage}%</span>
      </div>
      <div className="quota-bar-track" role="progressbar" aria-valuenow={item.percentage} aria-valuemin={0} aria-valuemax={100}>
        <div className={`quota-bar-fill quota-bar-fill--${tone}`} style={{ width: `${item.percentage}%` }} />
      </div>
      {resetLabel && <div className="quota-bar-meta">{resetLabel}</div>}
    </div>
  )
}
```

#### Steps

1. **Write `QuotaBar.test.tsx`** with these test cases:
   - Renders label and percentage
   - `>30%` → `quota-bar-fill--ok` class
   - `10–30%` → `quota-bar-fill--warn` class
   - `≤10%` → `quota-bar-fill--fault` class
   - `0%` → `fault` class
   - `100%` → `ok` class
   - Reset time in the future → shows `~Nh` or `~Nd Mh` format
   - Empty reset time → no meta div rendered
   - Past reset time → shows `resetting…`
   - Progress bar has correct `aria-valuenow`

2. **Run tests** — `cd apps/desktop && pnpm test -- QuotaBar` — confirm they fail.

3. **Create `QuotaBar.tsx`**.

4. **Run tests** — confirm all pass.

5. **Commit:** `feat(render): add QuotaBar progress bar component`

---

### Task 7: Integrate QuotaBar into OAuthAccountsView + CSS + tests

**Goal:** Display quota bars on each OAuth account card, add a refresh button, and auto-poll.

**Files:** `apps/desktop/src/render/src/views/OAuthAccountsView.tsx`, `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`, `apps/desktop/src/render/src/styles/meow.css`, `apps/desktop/src/render/src/test/setup.ts`

#### OAuthAccountsView.tsx changes

1. Add imports:
```typescript
import type { AntigravityQuotaData } from '@shared/ipc'
import { QuotaBar } from '../components/QuotaBar'
```

2. Add quota state and polling:
```typescript
  const [quotaData, setQuotaData] = useState<Record<string, AntigravityQuotaData>>({})
  const [quotaRefreshing, setQuotaRefreshing] = useState(false)

  const loadQuota = useCallback(async () => {
    try {
      const items = await window.meowGateway.quotaList()
      const map: Record<string, AntigravityQuotaData> = {}
      for (const item of items) map[item.providerId] = item
      setQuotaData(map)
    } catch {
      // silent — quota is non-critical
    }
  }, [])

  const refreshQuota = useCallback(async () => {
    setQuotaRefreshing(true)
    try {
      const items = await window.meowGateway.quotaRefresh()
      const map: Record<string, AntigravityQuotaData> = {}
      for (const item of items) map[item.providerId] = item
      setQuotaData(map)
    } catch {
      // silent
    } finally {
      setQuotaRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadQuota()
    const interval = setInterval(loadQuota, 60_000)
    return () => clearInterval(interval)
  }, [loadQuota])
```

3. Add a refresh button to the `ViewHeader`:
```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Button variant="ghost" onClick={refreshQuota} disabled={quotaRefreshing}>
            {quotaRefreshing ? 'Refreshing quota…' : 'Refresh quota'}
          </Button>
          <button className="google-signin-btn" onClick={handleSignIn} disabled={loggingIn}>
            ...
          </button>
        </div>
```

4. Add quota section to each card (after `oauth-card-info` div, before `oauth-card-actions`):
```tsx
              {quotaData[a.providerId] && quotaData[a.providerId].items.length > 0 && (
                <div className="oauth-quota-section">
                  {quotaData[a.providerId].items.map((item) => (
                    <QuotaBar key={item.key} item={item} />
                  ))}
                </div>
              )}
              {quotaData[a.providerId]?.error && (
                <div className="oauth-quota-error">{quotaData[a.providerId].error}</div>
              )}
              {quotaData[a.providerId] && quotaData[a.providerId].items.length === 0 && !quotaData[a.providerId].error && (
                <div className="oauth-quota-empty">No quota data</div>
              )}
```

5. Also call `loadQuota()` after sign-in/reconnect completes (in `handleSignIn` and `handleReconnect`, after `await refresh()`):
```typescript
      await loadQuota()
```

#### CSS changes (`meow.css`)

Append these styles (after the existing oauth styles, or at the end):

```css
/* ---------- quota bars ---------- */
.oauth-quota-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0 6px;
  border-top: 1px solid var(--hairline);
}

.quota-bar {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.quota-bar-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quota-bar-label {
  font-size: 11px;
  color: var(--text-dim);
}

.quota-bar-pct {
  font-size: 11px;
  font-weight: var(--fw-semibold);
}
.quota-bar-pct--ok { color: var(--green); }
.quota-bar-pct--warn { color: var(--yellow); }
.quota-bar-pct--fault { color: var(--red); }

.quota-bar-track {
  height: 4px;
  background: var(--bg-hover);
  border-radius: 2px;
  overflow: hidden;
}

.quota-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.quota-bar-fill--ok { background: var(--green); }
.quota-bar-fill--warn { background: var(--yellow); }
.quota-bar-fill--fault { background: var(--red); }

.quota-bar-meta {
  font-size: 10px;
  color: var(--text-faint);
}

.oauth-quota-error {
  font-size: 11px;
  color: var(--red);
  padding: 6px 0;
}

.oauth-quota-empty {
  font-size: 11px;
  color: var(--text-faint);
  padding: 6px 0;
}
```

#### test/setup.ts changes

Add to the `window.meowGateway` mock object:
```typescript
    quotaList: vi.fn().mockResolvedValue([]),
    quotaRefresh: vi.fn().mockResolvedValue([]),
```

#### OAuthAccountsView.test.tsx changes

Add these test cases:
- Quota bars render when `quotaList` returns data for an account
- No quota section when `quotaList` returns empty array
- Error text renders when quota data has `error` field
- "No quota data" renders when items empty and no error
- "Refresh quota" button calls `quotaRefresh`
- Refresh button shows "Refreshing quota…" while loading

Mock quota data:
```typescript
const mockQuotaData = [{
  providerId: 'ag1',
  items: [
    { key: 'claude:5h', label: 'Claude (5h)', percentage: 65, resetTime: '2099-01-01T00:00:00Z' },
    { key: 'claude:weekly', label: 'Claude (Weekly)', percentage: 40, resetTime: '2099-01-07T00:00:00Z' }
  ],
  tier: 'individual',
  lastUpdatedAt: Date.now()
}]
```

#### Steps

1. **Edit `test/setup.ts`** — add `quotaList` and `quotaRefresh` mocks.

2. **Add new tests** to `OAuthAccountsView.test.tsx`.

3. **Run tests** — `cd apps/desktop && pnpm test -- OAuthAccountsView` — confirm new tests fail.

4. **Edit `OAuthAccountsView.tsx`** — add imports, state, polling, refresh button, quota section.

5. **Edit `meow.css`** — add quota bar styles.

6. **Run tests** — confirm all pass.

7. **Run typecheck** — `cd apps/desktop && pnpm typecheck`.

8. **Run lint** — `cd apps/desktop && pnpm lint`.

9. **Commit:** `feat(render): display quota bars on OAuth account cards with auto-polling`

---

### Task 8: Final verification + docs update

**Goal:** Verify everything works end-to-end and update docs.

#### Steps

1. **Run all tests across the workspace:**
   ```bash
   pnpm test
   ```

2. **Run typecheck across the workspace:**
   ```bash
   pnpm typecheck
   ```
   (Or per-package if no workspace-level script exists.)

3. **Run lint across the workspace:**
   ```bash
   pnpm lint
   ```

4. **Check for secrets in logs/tests:** grep for any access tokens, client secrets, or credential values in new test files. The existing `ANTIGRAVITY_OAUTH_CLIENT` in metadata.ts is a known POC deviation (already documented); do not add new ones.

5. **Update `docs/PRD.md`** — add quota display to the "Observability" section under MVP capabilities:
   ```markdown
   - Antigravity 5h/weekly quota display on OAuth cards.
   ```

6. **Update `README.md`** if it lists features — add quota display if there's a features list.

7. **Commit:** `docs: update PRD and README with quota display feature`

8. **Final commit (if any remaining):** `chore: final verification pass for quota display`