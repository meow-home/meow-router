# Meow Gateway v1.0 — Design / Specification

**Date:** 2026-08-29
**Status:** Draft (awaiting user review)
**Scope:** Full project v1.0 (all 8 phases from `docs/DEVELOPMENT_PLAN.md`)

This is an umbrella spec that defines the v1.0 architecture and every component. Each phase is implemented as a separate vertical slice via its own implementation plan (writing-plans skill). It is NOT one monolithic implementation.

---

## 1. Overview

Meow Gateway is a cross-platform Electron desktop app that connects cloud AI providers, securely stores credentials, discovers models, exposes a local OpenAI-compatible API on `127.0.0.1:8317`, routes requests to a selected provider/model, and tracks usage/cost.

The primary consumer is a coding agent (Meow Coding, OpenCode, Claude Code, Aider, Cline/Roo Code, etc.) that should not need to know which provider is behind the gateway.

### Non-goals (v1)

- Training/hosting local LLMs.
- General-purpose reverse proxy for arbitrary HTTP traffic.
- Cloud credential sync.
- Multi-user remote gateway hosting.
- Automatic provider account creation.
- Scraping private provider dashboards.

---

## 2. Chosen approach

**Approach A — Full monorepo, worker-process gateway, capability/budget-aware routing, security-first.**

Confirmed technical decisions (from brainstorming):
- **Repository:** pnpm workspace monorepo with `apps/desktop` (Electron) + `packages/provider-*`.
- **Provider packages:** all 7 (openai, deepseek, anthropic, gemini, openrouter, zhipu, qwen), fully implemented.
- **Credential storage:** Electron `safeStorage` (OS Keychain/DPAPI/libsecret), behind a `CredentialStore` interface.
- **Persistence:** `better-sqlite3` with a thin repository layer + hand-written idempotent migrations (no ORM).
- **Build tooling:** `electron-vite` for main/preload/render, Electron Builder for packaging.
- **Gateway runtime:** dedicated Node `utilityProcess` worker.
- **Routing:** full capability-aware + budget-aware, plus primary/fallback + retry.
- **UI:** React with Tailwind CSS + shadcn/ui, dark-first.

---

## 3. System architecture

### 3.1 Repository layout

```
meow-router/
 apps/desktop/
   src/
     main/                     # Electron main process
       app/                    # app lifecycle, window management
       ipc/                    # typed IPC handlers + validation
       services/               # Config, Model, Usage services
       credentials/            # CredentialStore (safeStorage)
       database/               # SQLite + hand migrations
       gateway/                # utilityProcess worker bootstrap for the HTTP server
     preload/                  # narrow typed IPC bridge (contextIsolation)
     render/                   # React app (Tailwind + shadcn/ui)
       pages/ components/ stores/ api/
     shared/                   # shared types/schemas across processes
 packages/
   provider-core/              # ProviderAdapter interface, normalized types, error taxonomy
   provider-openai/
   provider-deepseek/
   provider-anthropic/
   provider-gemini/
   provider-openrouter/
   provider-zhipu/
   provider-qwen/
```

### 3.2 Process roles (isolated)

1. **Renderer (React)** — presentation only. Never holds credentials, never calls providers, never starts servers. All privileged ops go through the preload bridge.
2. **Main process** — owns `CredentialStore` (safeStorage), SQLite database, provider registry, model/usage services, and app lifecycle. Owns the gateway worker via `utilityProcess`.
3. **Gateway worker (utilityProcess)** — the local HTTP server (`127.0.0.1:8317`). Runs `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` (streaming SSE). Talks to main over a typed IPC bridge for credential lookup, model resolution, request cancellation, and usage recording. Isolated so long-lived streams never block the UI.

### 3.3 Dependency direction

```
render → preload → main → gateway worker
```

Provider packages depend only on `provider-core`. The gateway worker and main both depend on `provider-core`, never on a specific provider package directly — resolution happens via the registry.

### 3.4 Data flow (chat request)

```
HTTP → auth → validate → resolve virtual model → router (capability+budget policy)
    → ProviderAdapter.chat(...) [in worker, via provider registry]
    → streaming normalization → usage extraction → cost calc
    → SSE response
```

Abort propagates from HTTP client → worker → main → provider `AbortSignal`.

### 3.5 Credential flow

The render never sees key material. It sends an opaque `credentialRef`. Main resolves it via `CredentialStore` only where the secret is needed (inside the gateway worker bridge). All IPC/HTTP payloads are schema-validated.

---

## 4. Data model & persistence

### 4.1 Store & migrations

- **SQLite** via `better-sqlite3`.
- Thin **repository layer** (no ORM): `ProviderRepository`, `ModelRepository`, `VirtualModelRepository`, `RoutingPolicyRepository`, `RequestUsageRepository`, `GatewayConfigRepository`.
- `MigrationRunner` applies versioned, **idempotent** migrations in order, recording applied versions in a `schema_migrations` table.

### 4.2 Tables

- **Provider** — `id`, `type`, `display_name`, `enabled`, `base_url`, `created_at`, `updated_at`. Credentials referenced only by a secure-store key, never stored here.
- **Account** — `id`, `provider_id`, `display_name`, `credential_ref`, `status`, `created_at`, `updated_at`. Multiple accounts per provider supported.
- **Model** — `id`, `provider_id`, `provider_model_id`, `display_name`, `context_window`, `input_price`, `output_price`, `capabilities_json`, `enabled`, `discovered_at`.
- **VirtualModel** — `id`, `display_name`, `provider_id`, `provider_model_id`, `routing_policy_id` (nullable), `enabled`, `created_at`, `updated_at`.
- **RoutingPolicy** — `id`, `name`, `strategy`, `config_json`.
- **RequestUsage** — `id`, `request_id`, `virtual_model_id`, `provider_id`, `provider_model_id`, `input_tokens`, `output_tokens`, `cached_tokens`, `estimated_cost`, `latency_ms`, `status`, `error_code` (nullable), `created_at`.
- **GatewayConfig** — `id`, `host`, `port`, `auth_enabled`, `startup_enabled`.
- **schema_migrations** — `version` (PK), `name`, `applied_at`.

### 4.3 Migration rules

- Every schema change = a new versioned migration.
- Migrations are idempotent (re-runnable).
- Never destructive; no user data deleted during startup migration.
- Backup/export is future, but destructive migrations are forbidden.

### 4.4 Secrets

Never stored in SQLite. Lives in `CredentialStore` keyed by `credential_ref`. Only the opaque ref is persisted.

Models are "self-discovered" — fetched from provider `/models` and cached in `Model`, refreshed on demand.

---

## 5. Provider adapter abstraction & registry

### 5.1 Contract (`provider-core`)

```ts
interface ProviderAdapter {
 id: string;                         // "openai", "deepseek", ...
 getModels(ctx: ProviderContext): Promise<ModelInfo[]>;
 validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult>;
 chat(
   ctx: ProviderContext,
   request: NormalizedChatRequest
 ): AsyncIterable<NormalizedChatChunk>;
}
```

`ProviderContext = { credentialRef, baseUrl?, signal, requestId }`. The worker resolves the actual secret only inside the adapter call, via the credential IPC bridge.

### 5.2 Capability declaration

```ts
type ModelCapabilities = {
 streaming: boolean;
 tools: boolean;
 vision: boolean;
 reasoning: boolean;
 structuredOutput: boolean;
};
```

### 5.3 Registry (`provider-registry`)

Maps `providerId → ProviderAdapter` at runtime. The only place provider packages are imported. The router and gateway worker depend on the registry, never on a specific provider. Adding a provider = new package + registration entry + tests; no router/business-logic changes.

### 5.4 Provider package structure

Each `packages/provider-*` contains:
```
adapter.ts           # implements ProviderAdapter
metadata.ts         # provider metadata: name, auth type, model URL, known capabilities
schemas.ts          # request/response zod schemas for that provider
adapter.test.ts     # against a mocked HTTP server (deterministic, offline)
fixtures/           # canned provider responses
```

### 5.5 Normalized types & error taxonomy

- `NormalizedChatRequest`, `NormalizedChatChunk` (role/delta/tool_calls/finish_reason), `ModelInfo`, `CredentialCheckResult`.
- Error taxonomy (from ARCHITECTURE): `CLIENT_ERROR`, `AUTH_ERROR`, `RATE_LIMIT`, `PROVIDER_UNAVAILABLE`, `MODEL_NOT_FOUND`, `REQUEST_REJECTED`, `TIMEOUT`, `STREAM_ERROR`, `INTERNAL_ERROR`.
- Error mapping: adapters translate provider-specific errors into the taxonomy, extracting `retry_after` for rate limits and producing a safe user-facing message. Only safely-retryable failures are marked retryable.
- Unsupported capabilities are explicitly rejected (never silently dropped).

---

## 6. Gateway, streaming & routing

### 6.1 Gateway worker (utilityProcess)

`http`/`undici` server bound to `127.0.0.1:8317` (default; never `0.0.0.0`). Exposes:
- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`

### 6.2 Request pipeline

```
auth (optional local gateway key) → body validation (zod) → resolve virtual model
→ routing policy (capability + budget aware) → provider adapter chat()
→ streaming normalization → usage extraction → cost calc → SSE
```

### 6.3 Streaming (SSE)

Each chunk emitted as `data: {...}\n`, terminated by `data: [DONE]\n`. Streaming is end-to-end: the adapter yields `NormalizedChatChunk`s; the worker serializes to OpenAI SSE, preserving tool-call deltas and `finish_reason`.

### 6.4 Cancellation & timeouts

Each request accepts an `AbortSignal`. Client disconnect or worker timeout aborts the signal, which propagates through registry → adapter → upstream `fetch`. `requestId` correlation ID preserved throughout.

### 6.5 Concurrency

No global mutable request state. Each request is an independent async pipeline; concurrent streams supported; aborted requests cleaned up.

### 6.6 Port lifecycle

On start, bind to `127.0.0.1:port`, verify health, then non-blockingly update render status. If port occupied, surface a clear error — never silently pick another port unless explicitly configured.

### 6.7 Routing (Phase 7)

Router selects provider/model from a `RoutingPolicy` whose `strategy` + `config_json` encode:
- **primary/fallback + retry** — ordered candidates, bounded retries with backoff on retryable failures.
- **capability-aware** — filters candidates by required capabilities from `Model.capabilities_json`.
- **budget-aware** — scores candidates by `input_price`/`output_price` against a budget constraint.

Unsupported capabilities rejected explicitly by router (matching ADR-002).

### 6.8 Error contract

OpenAI-compatible error envelope `{ error: { message, type, code } }` with a normalized code. Never returns provider secrets or authorization headers.

---

## 7. Security, observability & testing

### 7.1 Security model

- **Credentials:** AES-encrypted via Electron `safeStorage`, behind `CredentialStore` interface. Never in SQLite, localStorage, logs, errors, or render IPC payloads.
- **Renderer hardening:** `contextIsolation: true`, `nodeIntegration: false`, narrow typed preload API, CSP, no arbitrary navigation, IPC payload validation (zod).
- **Local server:** only `127.0.0.1`; never `0.0.0.0`. Optional local gateway key auth. Remote binding is explicit opt-in with warnings + auth.
- **SSRF guard:** reject/warn on custom provider URLs targeting localhost, private IPs, link-local, or metadata-service addresses, unless an explicit advanced setting allows it.
- **HTTP hardening:** body size limit, JSON validation, request timeout, `AbortSignal`, sanitized error responses.
- **Logging:** default logs contain `requestId`, provider, model, status, latency, token counts. Never log Authorization headers, API keys, full prompts, or full responses.

### 7.2 Observability (Usage & Cost, Phase 5)

- Every completed request records a `RequestUsage` row (tokens, cached tokens, latency, status, error code).
- `CostCalculator` computes `estimated_cost` deterministically from `Model.input_price`/`output_price`.
- Dashboard aggregates: requests, input/output/cached tokens, estimated cost, average latency, error counts; filterable by date/provider/model/status.

### 7.3 Testing strategy

- **Unit:** normalization, model mapping, routing, cost calc, schema validation, error mapping.
- **Integration:** SQLite + migrations, `CredentialStore`, provider adapters against a deterministic local mock provider, gateway routes, streaming, cancellation.
- **End-to-end:** start app → add mock provider → discover model → select virtual model → start gateway → send OpenAI-compatible request → receive streamed response → verify usage record.
- **Mock provider:** deterministic, offline, supports normal/streaming/auth-failure/rate-limit/timeout/malformed-upstream.
- **Security tests:** no credential leakage, localhost binding, invalid IPC rejected, oversized request rejected, malformed JSON rejected, provider URL validation.
- All tests deterministic and offline (except optional marked live-provider tests).

### 7.4 Error UX

Errors explain *what happened / why / what to do*; never raw stack traces by default.

---

## 8. Phases & sequencing

Sequenced according to `docs/DEVELOPMENT_PLAN.md` and `docs/TASK_INDEX.md`; each phase is a separate vertical slice with its own implementation plan.

| Phase | Scope | Tasks |
|---|---|---|
| 0 | Bootstrap | T001 |
| 1 | Persistence & credentials | T101, T103 |
| 2 | Provider abstraction | T201, T202, T203, T204 |
| 3 | Local gateway | T301, T304, T305 |
| 4 | Virtual models | T401 |
| 5 | Usage & cost | T501 |
| 6 | Additional providers | T601–T606 |
| 7 | Routing & fallback | T701–T705 |
| 8 | Production hardening | T801–T806 |

Rule: do not start a later phase if the previous phase's exit criteria are failing, unless the user explicitly requests parallel work.

---

## 9. Definition of done (project-wide)

A task is complete only when implementation finished, unit/integration tests pass, typecheck passes, lint passes, no secrets in logs/tests/fixtures, relevant docs updated, and acceptance criteria in the task file are checked.
