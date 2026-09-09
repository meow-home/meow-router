# Antigravity Quota Display — Design Spec

## Overview

Display 5-hour and weekly quota limits for Antigravity OAuth accounts directly on OAuth account cards in the Meow Gateway desktop app. Shows per-model breakdown (Claude 5h, Claude Weekly, Gemini 5h, Gemini Weekly) with progress bars, percentage remaining, and reset time countdown.

## Motivation

Antigravity (Cloud Code Assist) enforces two quota windows:
- **5-hour sliding window** — resets ~5 hours after first usage in the window
- **Weekly window** — resets at the end of the calendar week

Users need visibility into remaining quota to plan model usage and avoid hitting rate limits during coding sessions.

## Data Model

### Shared IPC Types (`apps/desktop/src/shared/ipc.ts`)

```typescript
/** Single quota bucket (e.g. Claude 5h, Gemini Weekly). */
interface QuotaItem {
  key: string           // 'claude:5h' | 'claude:weekly' | 'gemini:5h' | 'gemini:weekly' | raw bucket id
  label: string         // Human-readable: 'Claude (5h)', 'Gemini (Weekly)', etc.
  percentage: number    // 0–100, remaining quota fraction
  resetTime: string     // ISO 8601 timestamp or '' if unavailable
}

/** Quota snapshot for one Antigravity account. */
interface AntigravityQuotaData {
  providerId: string          // maps to OAuthAccountMeta.providerId
  items: QuotaItem[]          // up to 4 items: Claude 5h, Claude Weekly, Gemini 5h, Gemini Weekly
  tier: string                // subscription tier: 'free' | 'individual' | 'enterprise' | ''
  lastUpdatedAt: number       // Date.now() at last successful fetch
  error?: string              // human-readable error if last fetch failed
}
```

## Upstream API

Two Cloud Code Assist endpoints, called with the account's OAuth Bearer token:

### 1. `POST {baseUrl}/v1internal:fetchAvailableModels`

**Request:** `{ "project": "<projectId>" }` (project id may be omitted)

**Response:**
```json
{
  "models": {
    "claude-3-5-sonnet": {
      "displayName": "Claude 3.5 Sonnet",
      "quotaInfo": {
        "remainingFraction": 0.85,
        "resetTime": "2026-09-09T14:30:00Z"
      }
    }
  }
}
```

Used as fallback when `retrieveUserQuotaSummary` doesn't provide bucket-level data.

### 2. `POST {baseUrl}/v1internal:retrieveUserQuotaSummary`

**Request:** `{ "project": "<projectId>" }` (same project)

**Response:**
```json
{
  "groups": [{
    "buckets": [{
      "bucketId": "3p-5h",
      "displayName": "Claude (5h)",
      "remainingFraction": 0.65,
      "resetTime": "2026-09-09T12:00:00Z"
    }, {
      "bucketId": "3p-weekly",
      "displayName": "Claude (Weekly)",
      "remainingFraction": 0.40,
      "resetTime": "2026-09-14T00:00:00Z"
    }]
  }]
}
```

This is the preferred source: it provides explicit 5h/weekly buckets. When the API returns no summary data, the system falls back to matching model names from `fetchAvailableModels`.

### Base URL resolution

Same as existing adapter: `https://daily-cloudcode-pa.googleapis.com` for non-GCP-ToS accounts, `https://cloudcode-pa.googleapis.com` for GCP-ToS, with env override via `ANTIGRAVITY_CLOUD_CODE_URL_OVERRIDE`. The adapter's `baseUrlsToTry()` fallback chain is reused.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Renderer (OAuthAccountsView)                       │
│  ┌─────────────────────────────────────────┐        │
│  │ OAuth Card                              │        │
│  │  Name / Email / Status                  │        │
│  │  ┌──────── Quota Section ─────────┐     │        │
│  │  │ Claude (5h)    ████░░  65%  2h │     │        │
│  │  │ Claude (Weekly) ███░░░  40%  5d│     │        │
│  │  │ Gemini (5h)    █████░  85%  3h │     │        │
│  │  │ Gemini (Weekly) ██████  92%  6d│     │        │
│  │  └────────────────────────────────┘     │        │
│  └─────────────────────────────────────────┘        │
│      ↕ IPC (quota:list, quota:refresh)              │
├─────────────────────────────────────────────────────┤
│  Main Process                                       │
│  ┌───────────────┐  ┌──────────────────────┐        │
│  │ QuotaService   │←→│ AntigravityAdapter   │        │
│  │ (polling,cache)│  │ (getQuota method)    │        │
│  └───────────────┘  └──────────────────────┘        │
│        ↕                     ↕                      │
│  OAuthTokenManager    Cloud Code Assist API         │
└─────────────────────────────────────────────────────┘
```

### Layer 1: Adapter — `AntigravityAdapter.getQuota()`

**File:** `packages/provider-antigravity/src/adapter.ts`

New method on `AntigravityAdapter`:

```typescript
async getQuota(ctx: ProviderContext): Promise<RawQuotaResponse>
```

- Calls both endpoints in sequence (fetchAvailableModels first, then retrieveUserQuotaSummary)
- Resolves auth via existing `resolveAuth(ctx)` and project via `resolveProject()`
- Returns raw JSON data (no parsing into QuotaItem here)
- Tries `baseUrlsToTry()` for resilience
- Exported type:

```typescript
interface RawQuotaResponse {
  models: Record<string, { displayName?: string; quotaInfo?: { remainingFraction?: number; resetTime?: string } }>
  quotaSummary?: { groups?: Array<{ buckets?: Array<{ bucketId?: string; displayName?: string; remainingFraction?: number; resetTime?: string }> }> }
  tier?: string
}
```

### Layer 2: Quota Parser — `packages/provider-antigravity/src/quotaParser.ts`

New file. Pure function, no side effects, highly testable:

```typescript
function parseQuotaResponse(raw: RawQuotaResponse): QuotaItem[]
```

**Model matching logic** (ported from cockpit-tools `getAntigravityQuotaDisplayItems`):

| Key | Priority 1 (exact bucket id) | Priority 2 (model name match) |
|-----|------------------------------|-------------------------------|
| `claude:5h` | `3p-5h` or `claude:5h` | name contains `claude` + (`high` or no `low`) |
| `claude:weekly` | `3p-weekly` or `claude:weekly` | name contains `claude` + `low` |
| `gemini:5h` | `gemini-5h` or `gemini:5h` | name contains `gemini` + `high`/`flash` (not `low`) |
| `gemini:weekly` | `gemini-weekly` or `gemini:weekly` | name contains `gemini` + `low` |

**Gemini 5h override:** If Gemini 5h reset time is >5 hours in the future, it means the weekly limit is capping the 5h limit → set percentage to 100% and clear reset time (matches cockpit-tools behavior).

### Layer 3: QuotaService — `apps/desktop/src/main/quota/quotaService.ts`

```typescript
class QuotaService {
  private cache: Map<string, AntigravityQuotaData>
  private timer: NodeJS.Timeout | null
  private pollIntervalMs: number  // default 60_000

  constructor(
    adapter: AntigravityAdapter,
    tokenManager: OAuthTokenManager,
    providerRepo: ProviderRepository,
    logger: Logger
  )

  /** Fetch quota for all Antigravity OAuth accounts, update cache. */
  async refreshAll(): Promise<AntigravityQuotaData[]>

  /** Fetch quota for one account. */
  async refreshProvider(providerId: string): Promise<AntigravityQuotaData>

  /** Return cached data for all accounts. */
  getAll(): AntigravityQuotaData[]

  /** Start polling. Called from bootstrap once at startup. */
  start(): void

  /** Stop polling. Called on app shutdown. */
  stop(): void
}
```

**Account discovery:** `QuotaService` calls `providerRepo.list()` and filters to `type === 'antigravity'`. For each matching provider, it builds a `ProviderContext` with the credential ref, then calls `adapter.getQuota(ctx)`.

**Polling:** `setInterval` every 60 seconds. Each tick calls `refreshAll()`. Polling starts automatically in `bootstrap.ts` after services are wired up. Polling continues even if individual accounts fail.

### Layer 4: IPC Channels

**New channels in `ipc.ts`:**

```typescript
quota: {
  list: 'quota:list',
  refresh: 'quota:refresh',
}
```

**New methods in `WindowApi`:**

```typescript
quotaList(): Promise<AntigravityQuotaData[]>
quotaRefresh(): Promise<AntigravityQuotaData[]>
```

**Handler wiring in `bootstrap.ts`:**

```typescript
ipcMain.handle(IPC_CHANNELS.quota.list, async () =>
  wrap(() => quotaService.getAll())
)
ipcMain.handle(IPC_CHANNELS.quota.refresh, async () =>
  wrap(() => quotaService.refreshAll())
)
```

### Layer 5: Preload Bridge

Expose in `preload.ts`:

```typescript
quotaList: () => ipcRenderer.invoke(IPC_CHANNELS.quota.list),
quotaRefresh: () => ipcRenderer.invoke(IPC_CHANNELS.quota.refresh),
```

### Layer 6: Renderer — `OAuthAccountsView.tsx`

**Quota section on each OAuth card:**

Each card gets a `<QuotaSection>` component below the existing actions area:

```
┌─────────────────────────────────────────┐
│ [Avatar] Name                [Connected]│
│          email@example.com              │
│                                         │
│  Claude (5h)    ████████░░  65%   ~2h   │
│  Claude (Weekly) ██████░░░░  40%   ~5d  │
│  Gemini (5h)    █████████░  85%   ~3h   │
│  Gemini (Weekly) ██████████  92%   ~6d  │
│                                         │
│             [Sign out]                  │
└─────────────────────────────────────────┘
```

**Progress bar colors:**
- `>30%` remaining → green (`var(--accent-green)`)
- `10–30%` remaining → yellow/amber (`var(--accent-amber)`)
- `≤10%` remaining → red (`var(--accent-red)`)

**Reset time display:** Human-readable relative time (e.g., "~2h", "~3d 5h"). If reset time is empty, omit.

**Refresh behavior:**
- Auto-poll: `useEffect` with `setInterval(60_000)` calls `quotaList()` to read cache
- Manual: "Refresh" button in ViewHeader calls `quotaRefresh()` and updates state

**New component:** `QuotaBar.tsx` — reusable progress bar with label, percentage, color class, and reset time. Styles in existing `index.css`.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Token expired | `OAuthTokenManager.getAccessToken()` auto-refreshes. If refresh fails → `error: "Token expired, please re-authenticate"` |
| API 403 | `error: "Account forbidden"`, no retry, item still shown with error text |
| API 5xx / network | Retry once with 1s backoff. If fails → keep stale cache data, set `error` field |
| No quota data from API | `items: []`, card shows "No quota data available" |
| Polling tick failure | Continue polling, log warning. Never log credentials or tokens |

## Security

- Quota fetch runs exclusively in main process
- Raw API responses (percentages + timestamps) are not sensitive
- OAuth access tokens never cross IPC boundary to renderer
- No credentials, authorization headers, or response bodies are logged
- `assertSafeEndpoint()` validates base URLs before fetching

## Testing

### Unit Tests

| File | Tests |
|------|-------|
| `packages/provider-antigravity/src/quotaParser.test.ts` | Parse all model name patterns; empty models; missing quotaInfo; Gemini 5h override when reset >5h; bucketId priority over model name match |
| `packages/provider-antigravity/src/adapter.test.ts` | `getQuota()`: mock fetch for both endpoints; auth error; 403/5xx; network failure; base URL fallback |
| `apps/desktop/src/main/quota/quotaService.test.ts` | Cache read/write; refreshAll with multiple accounts; polling start/stop; error isolation (one account fails, others succeed); timer cleanup |

### Component Tests

| File | Tests |
|------|-------|
| `apps/desktop/src/render/src/components/QuotaBar.test.tsx` | Renders correct color class for each percentage range; displays reset time; handles empty items |
| `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx` | Quota section appears with mock data; refresh button triggers quotaRefresh IPC; error state renders |

## Files Changed

### New Files
- `packages/provider-antigravity/src/quotaParser.ts` — pure quota parsing logic
- `packages/provider-antigravity/src/quotaParser.test.ts` — parser tests
- `apps/desktop/src/main/quota/quotaService.ts` — quota polling + cache service
- `apps/desktop/src/main/quota/quotaService.test.ts` — service tests
- `apps/desktop/src/render/src/components/QuotaBar.tsx` — progress bar component
- `apps/desktop/src/render/src/components/QuotaBar.test.tsx` — component tests

### Modified Files
- `packages/provider-antigravity/src/adapter.ts` — add `getQuota()` method + `RawQuotaResponse` type
- `packages/provider-antigravity/src/adapter.test.ts` — add getQuota tests
- `packages/provider-antigravity/src/index.ts` — re-export new types
- `apps/desktop/src/shared/ipc.ts` — add `QuotaItem`, `AntigravityQuotaData` types + IPC channels + WindowApi methods
- `apps/desktop/src/main/app/bootstrap.ts` — wire QuotaService, register IPC handlers, start polling
- `apps/desktop/src/main/preload/index.ts` (or wherever preload is) — expose quota IPC methods
- `apps/desktop/src/render/src/views/OAuthAccountsView.tsx` — integrate QuotaBar into cards
- `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx` — add quota rendering tests
- `apps/desktop/src/render/src/index.css` — quota bar styles

## Acceptance Criteria

- [ ] Each Antigravity OAuth card displays up to 4 quota bars (Claude 5h, Claude Weekly, Gemini 5h, Gemini Weekly)
- [ ] Each bar shows: label, colored progress bar, percentage, reset time countdown
- [ ] Color coding: green (>30%), amber (10–30%), red (≤10%)
- [ ] Auto-refresh every 60 seconds
- [ ] Manual refresh button works
- [ ] Error state shows on card without crashing
- [ ] Token refresh is handled transparently
- [ ] No credentials or tokens logged
- [ ] All unit tests pass
- [ ] TypeScript strict mode passes
- [ ] Lint passes
