# Design — Provider expansion, model sync & manual model entry

Status: Approved (brainstorming)
Date: 2026-08-29
Scope owner: Meow Gateway

## 1. Problem

The dashboard can currently only manage two hardcoded provider types (`openai` / `deepseek`) and can only *discover* models from a provider API — there is no way to add a provider via a generic OpenAI-compatible endpoint, no way to manually enter a model, and no way to sync models without clobbering the user's manual enable/disable choices. `providerService.describeProvider` additionally hardcodes provider metadata, which the previous review flagged as technical debt.

## 2. Goal

Make it easy to run many providers and own a curated model list:

- **Generic OpenAI-compatible providers** — any vendor exposing an OpenAI-compatible API (OpenRouter, Groq, Ollama, LM Studio, custom) is addable by typing a base URL, no adapter per vendor required in this slice.
- **Presets** — a few curated presets (OpenAI, OpenRouter, Groq, Ollama, LM Studio) appear in the type picker; a "custom/other" type lets the user type any base URL.
- **Manual model entry** — add and edit models with the full schema (provider, provider_model_id, display_name, context_window, prices, capabilities, enabled).
- **Safe sync** — "Sync Models" upserts from the provider API but preserves the user's enabled/disabled state and never auto-deletes; models that disappear upstream are marked *stale* rather than removed.
- **Kill the hardcode** — provider metadata and the type picker come from the adapter/registry, not a hardcoded map in `describeProvider`.

## 3. Architecture

Layering stays strict (Electron main / preload / render). No provider-specific logic leaks into the router or renderer.

### 3.1 Provider adapters (provider packages)
- Each package exports a metadata object (`id`, `displayName`, `defaultBaseUrl`, `authType`) and an adapter factory implementing `ProviderAdapter`.
- `provider-openai` is the base for every OpenAI-compatible endpoint. Its factory already accepts `id` + `fetcher`; **the adapter must read `baseUrl` from `ProviderContext.baseUrl`, never hardcode the vendor URL.** (Verify in implementation; if it currently hardcodes OpenAI's URL, thread the context `baseUrl` through so a custom base URL works.)
- The metadata in `provider-openai` expands to a list of curated variants (OpenAI, OpenRouter, Groq, Ollama, LM Studio) plus a generic "openai-compatible" entry.

### 3.2 Registry (provider-core)
- `registry.list()` returns the registered adapters; `providerService.providerTypes()` reads from it (source of truth). A small built-in descriptor map is only a *fallback* when the registry lacks an id, never the primary source.

### 3.3 Main process (`ProviderService`)
- Keep existing provider methods.
- Add `createModel(input: NewModel)` and `updateModel(id, patch)` for manual entry.
- Change `discoverModels(id)` to a **safe upsert** (see §5).
- Validate provider `type` is a known adapter id (already done in the prior slice).

### 3.4 IPC (`shared/ipc.ts` + preload + bootstrap)
- Add `NewModel` to the `@shared/ipc` re-exports.
- Add `model.create` and `model.update` channels.
- Add `createModel` / `updateModel` to `WindowApi` and the preload bridge.
- Reuse the existing `discoverModels` channel for sync (no new channel).

### 3.5 Render (`views`)
- `ModelsView`: add **Add Model**, **Edit Model** (shared form), and **Sync Models**; add a **Stale** column/badge.
- `ProvidersView`: type picker already reads from `listProviderTypes`; the "OpenAI-Compatible"/preset types surface automatically once metadata is registry-driven. No structural change beyond what the registry exposes.

### 3.6 Data
- No schema constraint on `provider.type` (free TEXT), so new/custom provider types need no table migration.
- Add a `stale` column to `model` (default `0`) via a tiny migration; `mapRow` maps it to boolean.

## 4. IPC & types

### 4.1 Input type (shared)
Reuse the existing `NewModel` type from `apps/desktop/src/main/database/types` (identical shape, already used by `modelRepo.create`), and re-export it from `@shared/ipc` like `ModelRow`/`NewGatewayConfig` are:
```ts
// database/types.ts (unchanged definition)
export type NewModel = {
  id?: string
  provider_id: string
  provider_model_id: string
  display_name: string
  context_window?: number | null
  input_price?: number | null
  output_price?: number | null
  capabilities_json?: string | null
  enabled?: boolean
}
// shared/ipc.ts adds: export type { ..., NewModel } from '../main/database/types'
```
The IPC methods use `NewModel`:
```ts
createModel(input: NewModel): Promise<ModelRow>
updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): Promise<ModelRow>
```

### 4.2 Channels
```ts
model: {
  listByProvider: 'model:list-by-provider',
  create: 'model:create',       // new
  update: 'model:update',       // new
  delete: 'model:delete',
  setEnabled: 'model:set-enabled'
}
```

### 4.3 WindowApi additions
```ts
createModel(input: NewModel): Promise<ModelRow>
updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): Promise<ModelRow>
```
Both implemented in the preload bridge and the render test mock.

## 5. Safe sync (`discoverModels`)

For each model returned by `adapter.getModels(context)`:
1. If the model already exists for `(provider_id, provider_model_id)`: update only metadata (`display_name`, `context_window`, `input_price`, `output_price`, `capabilities_json`). **Do not overwrite `enabled`** or other user-set values. Set `stale = 0`.
2. If it does not exist: create it (upsert), `enabled` defaults `true`, `stale = 0`.

After the loop, mark models under this provider that **were not in the API response** as `stale = 1`; do **not** delete them. Stale models remain listed (dimmed badge) and can be deleted by the user.

### MapRow + migration
- Migration: `ALTER TABLE model ADD COLUMN stale INTEGER NOT NULL DEFAULT 0` (safe default for existing rows).
- `mapRow`: `stale: r.stale === 1`.

## 6. UI (`ModelsView`)

### Add / Edit model form (full schema)
Fields: Provider (dropdown), Provider model ID (text), Display name (text), Context window (number, optional), Input price / Output price (number, optional), Capabilities (checkbox group → `capabilities_json`), Enabled (toggle, default true).

- **Add**: `createModel({ provider_id, provider_model_id, display_name, context_window, input_price, output_price, capabilities_json, enabled })`.
- **Edit**: same form pre-filled; submit `updateModel(id, patch)`. `provider_id` is locked (not editable).

### Sync Models
Rename the discover button to **"Sync Models"** → calls `discoverModels(providerId)`; after completion show "N models synced".

### Table
Keep existing columns and add **Stale** (dimmed badge when `stale`).

## 7. Error handling & validation

`bootstrap.ts` handlers validate:
- `model.create`: `provider_id`, `provider_model_id`, `display_name` non-empty strings; `input_price`/`output_price` optional non-negative numbers; `context_window` optional positive integer; `capabilities_json` optional string (length-capped, JSON-parseable); `enabled` optional boolean.
- `model.update`: `id` non-empty; same field validation; **reject changing `provider_id`**.

`ProviderService`:
- `createModel` ensures the provider exists (`providerRepo.findById`).
- `updateModel` rejects `provider_id` change and throws a clear "Model not found" when the id is missing.
- `capabilities_json` is user input → length-capped (≤ 4096) and parsed safely.

`wrap()` maps `ProviderError` / `CredentialError` (including `INVALID_INPUT`) to a safe `IpcResult` without exposing secrets.

## 8. Testing

- Unit (repo): `modelRepo.create`, `modelRepo.update` (some exist), add `stale` mapping test.
- Unit (service): `ProviderService.createModel` (validation, provider-exists), `updateModel` (reject provider_id change, "Model not found"), `discoverModels` safe-upsert (preserves `enabled`, marks stale, never deletes).
- Render: `ModelsView` Add/Edit/Sync against a mocked `window.meowGateway`; capabilities checkbox group → `capabilities_json`.
- Security: no secret in model payloads; `INVALID_INPUT` mapped; renderer receives no secret channel.
- Full `pnpm typecheck`, `pnpm lint`, `pnpm test` (all 4 packages).

## 9. Docs

- Update `docs/API.md` / `README.md` if the IPC/`WindowApi` contract changes (it does: `createModel`, `updateModel`, `NewModel` re-export).
- Note the new preset provider types and the `stale` concept in the model docs.

## 10. Definition of done (this slice)

- Generic OpenAI-compatible providers addable by typing a base URL; curated presets appear in the picker from registry metadata.
- `describeProvider` hardcode removed; metadata sourced from adapters/registry.
- Manual model add + edit (full schema) works via IPC + UI.
- "Sync Models" upserts safely: preserves enabled state, marks stale, never auto-deletes.
- `stale` migration applied; model repo maps it.
- Typecheck + lint + test pass (all 4 packages); no secrets in logs/tests/fixtures.
- Docs updated for the new IPC surface and provider presets.

## 11. Non-goals (this slice)

- Dedicated vendor adapters for Anthropic / Google Gemini / Mistral (own protocols) — future phase, each a new package + contract tests.
- Mirror/authoritative sync (auto-delete models missing upstream).
- Routing-policy editor UI (existing non-goal).
- Toast/multi-account UI polish (unchanged).

## 12. Future vendor extension (design note, not implemented)

To add a future vendor: add `provider-anthropic` implementing `ProviderAdapter` + export metadata; register in `bootstrap.ts` (`registry.register(createAnthropicAdapter('anthropic'))`); it auto-appears in the picker via registry-read metadata. No picker/handler change required.
