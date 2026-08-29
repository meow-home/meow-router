# Provider Expansion + Model Sync + Manual Model Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add any OpenAI-compatible provider by typing a base URL (plus curated presets), register models on their own, and sync models without clobbering manual choices.

**Architecture:** Provider metadata moves out of the hardcoded `describeProvider` map into the adapter/registry; the OpenAI-compatible adapter already reads `baseUrl` from `ProviderContext` so a custom endpoint works without a new package. Model management is exposed via two new IPC methods (`createModel`, `updateModel`) reusing the existing `NewModel` type, and `discoverModels` becomes a safe upsert that preserves `enabled` and marks missing models `stale` (with a small migration).

**Tech Stack:** TypeScript, Electron, react, vitest, SQLite (persistent), pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-08-29-provider-models-expansion-design.md`

## Global Constraints

- TypeScript strict mode; no unused locals/params.
- Renderer MUST NOT receive raw API keys; provider credentials stored via OS secure store.
- Provider-specific logic belongs in provider adapters, not the gateway router/render.
- Gateway API contracts remain provider-neutral.
- Validate all IPC input in `bootstrap.ts`.
- Never log credentials, authorization headers or request bodies.
- Local gateway binds to `127.0.0.1` by default, never `0.0.0.0`.
- Update documentation when behavior or configuration changes.
- Every feature must include tests.
- `provider.type` is a free TEXT column (no migration needed for new/custom types).
- Files may use CRLF on Windows; prefer `edit`/`apply-patch` on LF files and `perl -0pi -e` only when a file is CRLF.

---

### Task 1: Add `stale` column to `model` + mapRow mapping

**Files:**
- Modify: `apps/desktop/src/main/database/migrations.ts` (add migration version 5)
- Modify: `apps/desktop/src/main/database/repositories/modelRepository.ts` (`RawModel` type + `mapRow`)
- Modify: `apps/desktop/src/main/database/types.ts` (`ModelRow` gains `stale: boolean`)
- Test: `apps/desktop/src/main/database/repositories/modelRepository.test.ts`

**Interfaces:**
- Produces: `ModelRow` now includes `stale: boolean`; `migrate()` applies a `stale` column to `model`; `ModelRepository` maps it.
- Consumes: existing `PersistedConnection`/`Queryable`.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/main/database/repositories/modelRepository.test.ts`:

```ts
it('defaults stale to false and round-trips the flag', () => {
  const created = repo.upsertByProviderModel({
    provider_id: 'p1',
    provider_model_id: 'deepseek-chat',
    display_name: 'DeepSeek Chat'
  })
  expect(created.stale).toBe(false)
  const updated = repo.update(created.id, { stale: true })
  expect(updated?.stale).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- modelRepository`
Expected: FAIL — `created.stale` is `undefined` (type has no `stale`), `update` cannot accept `stale`.

- [ ] **Step 3: Add the `stale` column to `ModelRow`**

In `apps/desktop/src/main/database/types.ts`, add `stale: boolean` to `ModelRow`:

```ts
export interface ModelRow {
  id: string
  provider_id: string
  provider_model_id: string
  display_name: string
  context_window: number | null
  input_price: number | null
  output_price: number | null
  capabilities_json: string | null
  enabled: boolean
  discovered_at: string
  stale: boolean        // new
}
```

- [ ] **Step 4: Add migration version 5**

In `apps/desktop/src/main/database/migrations.ts`, append to `MIGRATIONS`:

```ts
  {
    version: 5,
    name: 'model_stale',
    up: (db) => {
      db.exec(`
        ALTER TABLE model ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
      `)
    }
  }
```

- [ ] **Step 5: Update `RawModel` + `mapRow` + `update`/`create`/`upsert`**

In `apps/desktop/src/main/database/repositories/modelRepository.ts`:

Change `RawModel`:
```ts
type RawModel = Omit<ModelRow, 'enabled' | 'stale'> & { enabled: number; stale: number }
```
Change `mapRow`:
```ts
function mapRow(r: RawModel): ModelRow {
  return { ...r, enabled: r.enabled === 1, stale: r.stale === 1 }
}
```
In `create`, set `stale: false` on the row object and include it in the INSERT column list + values. In `update`, include `stale` in the spread (it already spreads `...patch`), and add `stale` to the `SET` clause + `.run()` values. In `upsertByProviderModel`, when creating, set `stale: false` (default).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- modelRepository`
Expected: PASS.

- [ ] **Step 7: Run typecheck on the whole desktop package**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/database/migrations.ts apps/desktop/src/main/database/repositories/modelRepository.ts apps/desktop/src/main/database/types.ts apps/desktop/src/main/database/repositories/modelRepository.test.ts
git commit -m "feat(desktop): add stale flag to model + migration"
```

---

### Task 2: Safe upsert sync in `ProviderService.discoverModels`

**Files:**
- Modify: `apps/desktop/src/main/provider/providerService.ts`
- Modify: `apps/desktop/src/main/provider/providerService.test.ts`

**Interfaces:**
- Consumes: `ModelRepository.upsertByProviderModel`, `ModelRepository.update`, `ModelRepository.listByProvider`, `ModelRow.stale`.
- Produces: `discoverModels(id)` marks models missing from API response as `stale = 1` and updates metadata for surviving models while preserving `enabled`.

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/main/provider/providerService.test.ts`, add:

```ts
it('safe upsert preserves enabled and marks stale for missing models', async () => {
  const adapter = { id: 'deepseek', getModels: vi.fn().mockResolvedValue([
    { id: 'a', providerModelId: 'a', displayName: 'A', capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false } }
  ]) }
  registry.get.mockReturnValue(adapter)
  credentials.getCredential.mockResolvedValue('secret')
  // pre-existing model 'b' is present locally but won't be in the API response
  modelRepo.listByProvider.mockReturnValue([
    { id: 'm1', provider_id: 'p1', provider_model_id: 'a', display_name: 'A', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false },
    { id: 'm2', provider_id: 'p1', provider_model_id: 'b', display_name: 'B', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: false, discovered_at: '', stale: false }
  ])
  modelRepo.upsertByProviderModel.mockImplementation((input) => ({ ...(input as object), id: 'm1', enabled: true, discovered_at: '', stale: false }) as never)
  modelRepo.update.mockImplementation((id, patch) => ({ id, ...patch, stale: patch.stale ?? false } as never))

  await service.discoverModels('p1')

  expect(modelRepo.update).toHaveBeenCalledWith('m2', { stale: true })
  // the model present in API response was upserted; its enabled was NOT forced true
  expect(modelRepo.upsertByProviderModel).toHaveBeenCalledWith(expect.objectContaining({ provider_model_id: 'a', enabled: true }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: FAIL — current `discoverModels` does not mark stale and does not consult `listByProvider`.

- [ ] **Step 3: Rewrite `discoverModels`**

In `apps/desktop/src/main/provider/providerService.ts`, replace the current `discoverModels` body:

```ts
async discoverModels(id: string): Promise<ModelInfo[]> {
  const provider = this.providerRepo.findById(id)
  if (!provider) throw new Error(`Provider not found: ${id}`)
  const adapter = this.registry.get(provider.type)
  if (!adapter) throw new Error(`No adapter for type: ${provider.type}`)
  const ref = credentialRefFor(id)
  const secret = await this.credentials.getCredential(ref)
  const models = await adapter.getModels({
    credentialRef: ref,
    credential: secret ?? undefined,
    baseUrl: provider.base_url ?? undefined,
    signal: new AbortController().signal,
    requestId: randomUUID()
  })

  // Safe upsert: preserve the user's enabled/disabled choice, only refresh metadata.
  const present: Array<{ providerModelId: string }> = []
  for (const m of models) {
    present.push({ providerModelId: m.providerModelId })
    const existing = this.modelRepo.findByProviderModel(id, m.providerModelId)
    this.modelRepo.upsertByProviderModel({
      provider_id: id,
      provider_model_id: m.providerModelId,
      display_name: m.displayName,
      context_window: m.contextWindow ?? null,
      input_price: m.inputPrice ?? null,
      output_price: m.outputPrice ?? null,
      capabilities_json: JSON.stringify(m.capabilities),
      enabled: existing?.enabled ?? true
    })
  }

  // Anything under this provider not in the API response becomes stale.
  for (const row of this.modelRepo.listByProvider(id)) {
    if (!present.some((p) => p.providerModelId === row.provider_model_id)) {
      this.modelRepo.update(row.id, { stale: true })
    }
  }

  return models
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: PASS (the existing 6 tests + the new safe-upsert test).

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/provider/providerService.ts apps/desktop/src/main/provider/providerService.test.ts
git commit -m "feat(desktop): safe upsert sync in discoverModels (preserve enabled, mark stale)"
```

---

### Task 3: Expose model create/update via IPC + preload

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts` (channels + WindowApi + re-export `NewModel`)
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/app/bootstrap.ts` (two IPC handlers + validators)
- Modify: `apps/desktop/src/render/src/test/setup.ts` (mock `createModel`/`updateModel`)
- Test: `apps/desktop/src/main/app/bootstrap.test.ts` (if it exists; else add validator unit tests)

**Interfaces:**
- Produces: `WindowApi.createModel(input: NewModel): Promise<ModelRow>`, `WindowApi.updateModel(id, patch: Partial<Omit<NewModel, 'id'>>): Promise<ModelRow>`, `IPC_CHANNELS.model.create` / `model.update`, `NewModel` re-exported from `@shared/ipc`.
- Consumes: `NewModel` from `database/types`.

- [ ] **Step 1: Add `NewModel` re-export + channels + WindowApi**

In `apps/desktop/src/shared/ipc.ts`:
- Add `NewModel` to the import from `../main/database/types` and to the `export type { ... }` line.
- Add to `IPC_CHANNELS.model`:
```ts
model: {
  listByProvider: 'model:list-by-provider',
  create: 'model:create',        // new
  update: 'model:update',        // new
  delete: 'model:delete',
  setEnabled: 'model:set-enabled'
}
```
- Add to `WindowApi`:
```ts
createModel(input: NewModel): Promise<ModelRow>
updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): Promise<ModelRow>
```

- [ ] **Step 2: Implement in preload bridge**

In `apps/desktop/src/preload/index.ts`, add:
```ts
createModel: (input) => ipcRenderer.invoke(IPC_CHANNELS.model.create, input),
updateModel: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.model.update, id, patch),
```

- [ ] **Step 3: Add validator + handlers in bootstrap**

In `apps/desktop/src/main/app/bootstrap.ts`, add an `isValidModelInput` helper (near `isValidNewProviderInput`):

```ts
function isValidModelInput(v: unknown): v is NewModel {
  if (!isObject(v)) return false
  if (!isNonEmptyString(v['provider_id'])) return false
  if (!isNonEmptyString(v['provider_model_id'])) return false
  if (!isNonEmptyString(v['display_name'])) return false
  if (v['context_window'] !== undefined && v['context_window'] !== null && !isPositiveInt(v['context_window'])) return false
  if (v['input_price'] !== undefined && v['input_price'] !== null && !isNonNegativeNumber(v['input_price'])) return false
  if (v['output_price'] !== undefined && v['output_price'] !== null && !isNonNegativeNumber(v['output_price'])) return false
  if (v['capabilities_json'] !== undefined && v['capabilities_json'] !== null && (!isNonEmptyString(v['capabilities_json']) || v['capabilities_json'].length > 4096)) return false
  if (v['enabled'] !== undefined && typeof v['enabled'] !== 'boolean') return false
  return true
}
```
Ensure `isPositiveInt` and `isNonNegativeNumber` helpers exist (add them next to the other primitive validators; keep them private to bootstrap). Import `NewModel` in bootstrap.

Add two handlers in the Models section:

```ts
ipcMain.handle(IPC_CHANNELS.model.create, async (_e, input: NewModel): Promise<IpcResult<ModelRow>> => {
  if (!isValidModelInput(input)) return badRequest('Invalid model input.', 'INVALID_MODEL')
  return wrap(() => providerService.createModel(input))
})

ipcMain.handle(IPC_CHANNELS.model.update, async (_e, id: string, patch: Record<string, unknown>): Promise<IpcResult<ModelRow>> => {
  if (!isNonEmptyString(id) || !isObject(patch)) return badRequest('Invalid update arguments.', 'INVALID_MODEL')
  if (patch['provider_id'] !== undefined) return badRequest('provider_id cannot be changed.', 'INVALID_MODEL')
  return wrap(() => providerService.updateModel(id, patch as Partial<Omit<NewModel, 'id'>>) as ModelRow)
})
```

- [ ] **Step 4: Mock in render test setup**

In `apps/desktop/src/render/src/test/setup.ts`, add:
```ts
createModel: vi.fn().mockResolvedValue({ id: 'm', provider_id: '', provider_model_id: '', display_name: '', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false }),
updateModel: vi.fn().mockResolvedValue({ id: 'm', provider_id: '', provider_model_id: '', display_name: '', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false }),
```

- [ ] **Step 5: Run typecheck + existing tests**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop test`
Expected: PASS (no existing test should break; validation is additive).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/app/bootstrap.ts apps/desktop/src/render/src/test/setup.ts
git commit -m "feat(desktop): expose model create/update via IPC + preload"
```

---

### Task 4: `ProviderService.createModel` / `updateModel` + validation tests

**Files:**
- Modify: `apps/desktop/src/main/provider/providerService.ts`
- Modify: `apps/desktop/src/main/provider/providerService.security.test.ts` (validation tests)

**Interfaces:**
- Consumes: `ModelRepository.create`, `ModelRepository.update`, `ProviderRepository.findById`, `NewModel`, `ModelRow`.
- Produces: `createModel(input: NewModel): ModelRow` (throws if provider missing), `updateModel(id, patch): ModelRow` (throws if missing / rejects provider_id change).

- [ ] **Step 1: Write the failing validation test**

Add to `apps/desktop/src/main/provider/providerService.security.test.ts`:

```ts
it('createModel requires an existing provider', () => {
  providerRepo.findById.mockReturnValue(undefined)
  expect(() => service.createModel({ provider_id: 'nope', provider_model_id: 'm', display_name: 'M' })).toThrow()
})

it('updateModel rejects changing provider_id', () => {
  modelRepo.update.mockReturnValue({ id: 'm1', provider_id: 'p1', provider_model_id: 'm', display_name: 'M', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false })
  expect(() => service.updateModel('m1', { provider_id: 'p2' })).toThrow()
})
```
(Add `modelRepo`/`providerRepo` mocks as needed if not already present in that file.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService.security`
Expected: FAIL — `createModel`/`updateModel` do not exist.

- [ ] **Step 3: Implement `createModel` / `updateModel`**

In `apps/desktop/src/main/provider/providerService.ts`:

```ts
createModel(input: NewModel): ModelRow {
  if (!this.providerRepo.findById(input.provider_id)) {
    throw new Error(`Provider not found: ${input.provider_id}`)
  }
  return this.modelRepo.create({ ...input, stale: false })
}

updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): ModelRow {
  if (patch.provider_id !== undefined) {
    throw new ProviderError({ type: 'INVALID_INPUT', message: 'Model provider cannot be changed.', retryable: false })
  }
  const updated = this.modelRepo.update(id, patch as Partial<Omit<ModelRow, 'id' | 'created_at' | 'discovered_at'>>)
  if (!updated) {
    throw new ProviderError({ type: 'INVALID_INPUT', message: 'Model not found.', retryable: false })
  }
  return updated
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/provider/providerService.ts apps/desktop/src/main/provider/providerService.security.test.ts
git commit -m "feat(desktop): add createModel/updateModel to ProviderService"
```

---

### Task 5: Provider presets + metadata from registry (remove hardcode)

**Files:**
- Modify: `packages/provider-openai/src/metadata.ts`
- Modify: `packages/provider-openai/src/index.ts`
- Modify: `apps/desktop/src/main/provider/providerService.ts` (`providerTypes`, `describeProvider`)
- Modify: `apps/desktop/src/main/app/bootstrap.ts` (register preset adapters)
- Test: `apps/desktop/src/main/provider/providerService.test.ts`

**Interfaces:**
- Produces: a list of preset provider types (OpenAI, OpenRouter, Groq, Ollama, LM Studio, plus generic `openai-compatible`) whose metadata comes from the registry/adapter, and `providerTypes()` returns them.
- Consumes: `ProviderRegistry.register`, adapter factories.

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/main/provider/providerService.test.ts`:

```ts
it('providerTypes returns metadata from the registry, not a hardcoded map', () => {
  registry.list.mockReturnValue([
    { id: 'openai', getModels: vi.fn() },
    { id: 'openrouter', getModels: vi.fn() },
    { id: 'groq', getModels: vi.fn() }
  ])
  const types = service.providerTypes()
  expect(types.map((t) => t.id)).toEqual(['openai', 'openrouter', 'groq'])
  expect(types.find((t) => t.id === 'openai')?.defaultBaseUrl).toBe('https://api.openai.com/v1')
  expect(types.find((t) => t.id === 'openrouter')?.defaultBaseUrl).toBe('https://openrouter.ai/api/v1')
})
```
This requires the registry to be seeded with adapters whose ids map to known metadata. Since the test mocks `registry.list`, it must reflect the metadata that `providerService` will read from the adapters. In the test, because `describeProvider` reads from a **metadata map keyed by adapter id** (not the adapter object itself), we need that map to be the source. See Step 3 for the design.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: FAIL — `providerTypes` currently returns only `openai` + `deepseek` hardcoded; `openrouter`/`groq` not present, and `describeProvider` uses a hardcoded map.

- [ ] **Step 3: Implement preset metadata + registry-driven providerTypes**

In `apps/desktop/src/main/provider/providerService.ts`, replace `describeProvider`'s hardcoded map with a module-level `KNOWN_METADATA` map keyed by adapter id (sourced from provider packages), and make `providerTypes()` read adapter ids from the registry, mapping each id to metadata:

```ts
// Known provider metadata keyed by adapter id. This mirrors the provider
// packages; the registry is the runtime source of truth for WHICH providers
// exist (ids), while this map supplies display metadata. New providers just
// register an adapter and add an entry here — no picker change.
import { openaiCompatibleMetadata } from '@meow-gateway/provider-openai'
import { deepseekMetadata } from '@meow-gateway/provider-deepseek'

const KNOWN_METADATA: Record<string, ProviderTypeDescriptor> = {
  openai: { id: 'openai', displayName: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', authType: 'bearer' },
  openaiCompatibleMetadata.id: { id: openaiCompatibleMetadata.id, displayName: openaiCompatibleMetadata.displayName, defaultBaseUrl: openaiCompatibleMetadata.defaultBaseUrl, authType: openaiCompatibleMetadata.authType },
  deepseek: { id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' },
  openrouter: { id: 'openrouter', displayName: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', authType: 'bearer' },
  groq: { id: 'groq', displayName: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', authType: 'bearer' },
  ollama: { id: 'ollama', displayName: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434/v1', authType: 'bearer' },
  lmstudio: { id: 'lmstudio', displayName: 'LM Studio', defaultBaseUrl: 'http://127.0.0.1:1234/v1', authType: 'bearer' }
}

providerTypes(): ProviderTypeDescriptor[] {
  return this.registry.ids().map((id) => KNOWN_METADATA[id] ?? { id, displayName: id, defaultBaseUrl: '', authType: 'bearer' })
}
```

**PRESET DECISION (per design §12):** Ollama/LM Studio default to loopback. This is problematic with the SSRF guard (`assertSafeEndpoint` rejects loopback), so registering them as built-in adapters that *always* get used for chat would be blocked. Therefore **Ollama/LM Studio are shown as presets in the picker only** (metadata entry present) but the user must be able to opt into loopback via an explicit advanced allow. In this slice, to keep scope tight and avoid weakening SSRF, we **do not auto-register Ollama/LM Studio loopback adapters**. We register only remote preset adapters: `openai`, `openrouter`, `groq`. The generic `openai-compatible` type is also registered.

In `apps/desktop/src/main/app/bootstrap.ts`, register the remote presets:
```ts
registry.register(createOpenAICompatibleAdapter('openai'))
registry.register(createOpenAICompatibleAdapter('openrouter'))
registry.register(createOpenAICompatibleAdapter('groq'))
registry.register(createDeepSeekAdapter('deepseek'))
registry.register(createOpenAICompatibleAdapter('openai-compatible'))
```
Do NOT register `ollama`/`lmstudio` as runtime adapters in this slice (loopback SSRF remains blocked). If you do add them, they must only appear in the metadata map for the picker, not be registered.

- [ ] **Step 4: Update `provider-openai/metadata.ts`**

Add a generic export for the base OpenAI-compatible metadata id used by `openai-compatible`:
```ts
export const OPENAI_COMPATIBLE_ID = 'openai-compatible'
```
And ensure `openaiCompatibleMetadata` uses it. (Keep `ProviderMetadata` type exported.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: PASS.

- [ ] **Step 6: Run provider-core + openai package tests + typecheck**

Run: `pnpm --filter @meow-gateway/provider-openai test && pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/provider-openai/src/metadata.ts packages/provider-openai/src/index.ts apps/desktop/src/main/provider/providerService.ts apps/desktop/src/main/app/bootstrap.ts apps/desktop/src/main/provider/providerService.test.ts
git commit -m "feat(desktop): registry-driven provider presets + remove hardcoded metadata"
```

---

### Task 6: ModelsView — Add/Edit model form + Sync Models + Stale column

**Files:**
- Modify: `apps/desktop/src/render/src/views/ModelsView.tsx`
- Modify: `apps/desktop/src/render/src/views/ModelsView.test.tsx`
- Create: `apps/desktop/src/render/src/components/ModelForm.tsx` (optional; single-file form is acceptable)
- Modify: `apps/desktop/src/render/src/test/setup.ts` (already mocked in Task 3)

**Interfaces:**
- Consumes: `window.meowGateway.listProviders`, `listModelsByProvider`, `createModel`, `updateModel`, `discoverModels`, `deleteModel`, `setModelEnabled`.
- Produces: Add/Edit model form (full schema), Sync Models button (renamed from Refresh), Stale badge column.

- [ ] **Step 1: Write the failing render test**

Update `apps/desktop/src/render/src/views/ModelsView.test.tsx`:

```tsx
it('adds a model with the full schema', async () => {
  const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>
  gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true, base_url: 'https://api.openai.com/v1', hasCredential: true, created_at: '', updated_at: '' }])
  gw.listModelsByProvider.mockResolvedValue([])
  gw.createModel.mockResolvedValue({ id: 'm', provider_id: 'p1', provider_model_id: 'gpt-4o', display_name: 'GPT-4o', context_window: 128000, input_price: 2.5, output_price: 10, capabilities_json: '{"streaming":true,"tools":true,"vision":true,"reasoning":false,"structuredOutput":false}', enabled: true, discovered_at: '', stale: false })
  render(<ModelsView />)
  fireEvent.click(await screen.findByText('Add Model'))
  fireEvent.change(await screen.findByLabelText(/provider model id/i), { target: { value: 'gpt-4o' } })
  fireEvent.change(await screen.findByLabelText(/display name/i), { target: { value: 'GPT-4o' } })
  fireEvent.click(await screen.findByLabelText(/vision/i))
  fireEvent.click(await screen.findByText(/Save Model/i))
  await waitFor(() => expect(gw.createModel).toHaveBeenCalledWith(expect.objectContaining({ provider_model_id: 'gpt-4o', provider_id: 'p1', display_name: 'GPT-4o', capabilities_json: expect.stringContaining('"vision":true') })))
})

it('syncs models and renders a stale badge', async () => {
  const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>
  gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
  gw.listModelsByProvider.mockResolvedValue([{ id: 'm1', provider_id: 'p1', provider_model_id: 'old', display_name: 'Old', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: true }])
  gw.discoverModels.mockResolvedValue([])
  render(<ModelsView />)
  fireEvent.click(await screen.findByText('Sync Models'))
  await waitFor(() => expect(gw.discoverModels).toHaveBeenCalledWith('p1'))
  expect(await screen.findByText(/stale/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- ModelsView`
Expected: FAIL — no "Add Model", "Sync Models", stale badge.

- [ ] **Step 3: Implement ModelsView**

Rewrite `apps/desktop/src/render/src/views/ModelsView.tsx` to add:
- An "Add Model" toggle button that renders a form (Provider select from `listProviders`, provider_model_id, display_name, context_window, input_price, output_price, capabilities checkbox group, enabled toggle) with a "Save Model" button that calls `createModel`.
- An "Edit" button per row that pre-fills the same form and calls `updateModel(id, patch)`.
- Rename "Refresh models" → "Sync Models" (calls `discoverModels` then refreshes).
- A **Stale** column rendering `stale ? 'stale' : '—'`.

Keep the file focused; use a small inline form component or a shared `ModelForm.tsx`. The capabilities checkboxes map to `capabilities_json = JSON.stringify({ streaming, tools, vision, reasoning, structuredOutput })`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- ModelsView`
Expected: PASS.

- [ ] **Step 5: Run typecheck + full desktop tests + lint**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop lint && pnpm --filter @meow-gateway/desktop test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/src/views/ModelsView.tsx apps/desktop/src/render/src/views/ModelsView.test.tsx apps/desktop/src/render/src/components/ModelForm.tsx
git commit -m "feat(render): add/edit model form + sync models + stale badge"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `docs/API.md`, `README.md` (IPC contract + provider presets + stale concept)
- Test: full workspace

**Interfaces:**
- N/A (docs + verification).

- [ ] **Step 1: Update docs**

In `docs/API.md`, document the new `WindowApi` methods `createModel`/`updateModel`, the `model.create`/`model.update` channels, the `NewModel` re-export, and the `stale` field on `ModelRow`. In `README.md`, mention that OpenAI-compatible providers (Presets: OpenAI, OpenRouter, Groq) can be added by choosing a type and typing a base URL, and that "Sync Models" preserves user choices / marks stale models.

- [ ] **Step 2: Run full workspace verification**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
Expected: ALL PASS (4 packages). No secrets in logs/tests/fixtures.

- [ ] **Step 3: Commit**

```bash
git add docs/API.md README.md
git commit -m "docs: document model create/update IPC + provider presets + stale sync"
```

---

## Self-Review

**Spec coverage:**
- §2 Generic OpenAI-compatible + presets → Task 5.
- §2 Manual model entry → Tasks 3, 4, 6.
- §2 Safe sync (preserve enabled, mark stale) → Tasks 1, 2, 6.
- §3.3 `createModel`/`updateModel` → Task 4.
- §3.4 IPC channels + WindowApi → Task 3.
- §3.6 `stale` migration → Task 1.
- §5 Safe sync → Task 2.
- §6 UI → Task 6.
- §7 validation → Task 3 (+ Task 4 service-level).
- §8 tests → Tasks 1, 2, 4, 5, 6.
- §9 docs → Task 7.

**Placeholder scan:** No TBD/TODO/fill-in steps; every code step has real content.

**Type consistency:** `NewModel` reused everywhere (no `NewModelInput`); `ModelRow.stale: boolean` added once in Task 1 and referenced consistently; `discoverModels` returns `ModelInfo[]` (unchanged); `updateModel(id, patch: Partial<Omit<NewModel, 'id'>>)` consistent across Tasks 3/4/6.

**Notes:** Ollama/LM Studio loopback presets are NOT registered as runtime adapters (SSRF guard would block loopback); they appear only as picker metadata. This is documented in Task 5. If you want those endpoints to work, we'd need an explicit loopback-allow toggle — flagged as a follow-up, out of scope for this slice (keeps SSRF intact).
