# Provider-Management Dashboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the renderer dashboard for managing providers, credentials (secretly), models, virtual models, the local gateway, and usage/cost — wired through a narrow typed IPC bridge where the main process does all privileged work.

**Architecture:** Approad A — renderer is presentation-only and calls a narrow typed preload bridge; the main process owns the credential service, provider registry, repositories, and gateway. API keys flow exactly one way (render→main via `setCredential`), are stored in the OS secure store, and are never returned to the renderer. Each React view fetches its own data on mount; no new state/router/form framework is introduced.

**Tech Stack:** Electron main/preload/render, React 18, TypeScript strict, Vitest (jsdom + happy-dom for render), ESLint, `@meow-gateway/provider-core`, `@meow-gateway/provider-openai`, `@meow-gateway/provider-deepseek`.

**Spec:** `docs/superpowers/specs/2026-08-29-provider-management-dashboard-ui-design.md`

## Global Constraints

- TypeScript `strict: true`.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer must not access Node APIs directly (no `electron`/`node:` imports in `src/render`).
- Renderer never receives raw provider API keys.
- Provider credentials stored only through OS secure credential store (main process only).
- Local gateway binds to `127.0.0.1` by default, never `0.0.0.0`.
- Validate all IPC input.
- Validate all HTTP input.
- Never log credentials, authorization headers or request bodies by default.
- Streaming supported end-to-end; abort propagates client → provider.
- Provider-specific logic lives in provider adapters, not the gateway router.
- Gateway API contracts must remain provider-neutral.
- Use dependency injection at process boundaries.
- Every feature must include tests.
- pnpm is the package manager (install globally via `npm i -g pnpm` first).
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` after each task.

---

### Task 1: Extend shared IPC contract

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`

**Interfaces:**
- Consumes: existing `IPC_CHANNELS`, `WindowApi`, `IpcResult`, `VirtualModelRow`.
- Produces: new channel constants, `WindowApi` methods, and input types: `ProviderWithCredential`, `NewProviderInput`, `ProviderTypeDescriptor`, `GatewayStatus`, `ModelInfo` re-export, `DashboardTotals`, `RequestUsageRow`.

- [ ] **Step 1: Write the failing contract compile check (typecheck)**

Add new types to `apps/desktop/src/shared/ipc.ts`. The existing renderer test setup mocks `window.meowGateway`; this step only changes the type surface, so no runtime test runs yet. Verify it compiles by running the desktop typecheck; it should currently fail because `WindowApi` references types we will add next, and the preload doesn't yet implement them — that's expected.

Add these imports/type exports at the top of `ipc.ts`:

```ts
import type { VirtualModelRow, ModelRow, GatewayConfigRow, RequestUsageRow } from '../main/database/types'
import type { ModelInfo, CredentialCheckResult } from '@meow-gateway/provider-core'
```

Note: importing `ModelInfo`/`CredentialCheckResult` from `@meow-gateway/provider-core` is acceptable in `shared/ipc.ts` because these are pure types with no Electron/node deps. Do NOT import runtime values (e.g. `ProviderRegistry`) into the shared layer.

Add to `IPC_CHANNELS`:

```ts
export const IPC_CHANNELS = {
  ping: 'app:ping',
  provider: {
    list: 'provider:list',
    create: 'provider:create',
    update: 'provider:update',
    delete: 'provider:delete',
    setCredential: 'provider:set-credential',
    testConnection: 'provider:test-connection',
    discoverModels: 'provider:discover-models',
    types: 'provider:types'
  },
  model: {
    listByProvider: 'model:list-by-provider',
    delete: 'model:delete',
    setEnabled: 'model:set-enabled'
  },
  gateway: {
    getStatus: 'gateway:get-status',
    start: 'gateway:start',
    stop: 'gateway:stop',
    getConfig: 'gateway:get-config',
    saveConfig: 'gateway:save-config'
  },
  usage: {
    dashboardTotals: 'usage:dashboard-totals',
    listRecent: 'usage:list-recent'
  },
  virtualModel: { /* unchanged */ }
} as const
```

Add new input/return types after `NewVirtualModelInput`:

```ts
export interface NewProviderInput {
  type: string
  display_name: string
  base_url?: string | null
}

export type ProviderWithCredential = ProviderRow & { hasCredential: boolean }

export interface ProviderTypeDescriptor {
  id: string
  displayName: string
  defaultBaseUrl: string
  authType: string
}

export interface GatewayStatus {
  running: boolean
  host: string
  port: number
}
```

Add `ProviderRow` import to the type imports (it lives in `../main/database/types`):

```ts
import type { VirtualModelRow, ModelRow, ProviderRow, GatewayConfigRow, RequestUsageRow } from '../main/database/types'
```

- [ ] **Step 2: Run typecheck to verify the shared types compile**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: may still fail because `WindowApi`/preload don't reference new methods yet. That's fine for this task; we add method signatures in Task 2. For now just confirm shared types parse (the file has no runtime errors).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts
git commit -m "feat(desktop): extend shared IPC contract for provider/model/gateway/usage"
```

---

### Task 2: Extend preload bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS`, `WindowApi`, and new input/return types from `shared/ipc`.
- Produces: implemented `WindowApi` methods on `window.meowGateway`.

- [ ] **Step 1: Write the failing preload (renderer typing breaks)**

The `WindowApi` interface (from Task 1) now declares many methods that `api` does not implement. Update `apps/desktop/src/preload/index.ts`.

Keep the existing `invoke<T>` helper. Add new api methods. The full `api` object becomes:

```ts
const api: WindowApi = {
  ping: async () => {
    const payload: PingPayload = { from: 'preload' }
    return ipcRenderer.invoke(IPC_CHANNELS.ping, payload) as Promise<PingResult>
  },
  listProviders: () => invoke<ProviderWithCredential[]>(IPC_CHANNELS.provider.list),
  createProvider: (input: NewProviderInput) => invoke<ProviderRow>(IPC_CHANNELS.provider.create, input),
  updateProvider: (id, patch) => invoke<ProviderRow>(IPC_CHANNELS.provider.update, id, patch),
  deleteProvider: (id) => invoke<boolean>(IPC_CHANNELS.provider.delete, id),
  setProviderCredential: (id, secret) => invoke<void>(IPC_CHANNELS.provider.setCredential, id, secret),
  testProviderConnection: (id) => invoke<CredentialCheckResult>(IPC_CHANNELS.provider.testConnection, id),
  discoverModels: (id) => invoke<ModelInfo[]>(IPC_CHANNELS.provider.discoverModels, id),
  listProviderTypes: () => invoke<ProviderTypeDescriptor[]>(IPC_CHANNELS.provider.types),
  listModelsByProvider: (providerId) => invoke<ModelRow[]>(IPC_CHANNELS.model.listByProvider, providerId),
  deleteModel: (id) => invoke<boolean>(IPC_CHANNELS.model.delete, id),
  setModelEnabled: (id, enabled) => invoke<ModelRow>(IPC_CHANNELS.model.setEnabled, id, enabled),
  gatewayGetStatus: () => invoke<GatewayStatus>(IPC_CHANNELS.gateway.getStatus),
  gatewayStart: () => invoke<GatewayStatus>(IPC_CHANNELS.gateway.start),
  gatewayStop: () => invoke<GatewayStatus>(IPC_CHANNELS.gateway.stop),
  gatewayGetConfig: () => invoke<GatewayConfigRow>(IPC_CHANNELS.gateway.getConfig),
  gatewaySaveConfig: (cfg) => invoke<GatewayConfigRow>(IPC_CHANNELS.gateway.saveConfig, cfg),
  usageDashboardTotals: () => invoke<DashboardTotals>(IPC_CHANNELS.usage.dashboardTotals),
  usageListRecent: (limit) => invoke<RequestUsageRow[]>(IPC_CHANNELS.usage.listRecent, limit),
  listVirtualModels: () => invoke<VirtualModelRow[]>(IPC_CHANNELS.virtualModel.list),
  getVirtualModel: (id) => invoke<VirtualModelRow | null>(IPC_CHANNELS.virtualModel.get, id),
  createVirtualModel: (input) => invoke<VirtualModelRow>(IPC_CHANNELS.virtualModel.create, input),
  updateVirtualModel: (id, patch) => invoke<VirtualModelRow | null>(IPC_CHANNELS.virtualModel.update, id, patch),
  deleteVirtualModel: (id) => invoke<boolean>(IPC_CHANNELS.virtualModel.delete, id)
}
```

Add the import of the new types at the top:

```ts
import type {
  ProviderWithCredential,
  NewProviderInput,
  ProviderTypeDescriptor,
  GatewayStatus,
  ModelRow,
  GatewayConfigRow,
  RequestUsageRow,
  DashboardTotals
} from '../shared/ipc'
import type { ProviderRow } from '../main/database/types'
import type { ModelInfo, CredentialCheckResult } from '@meow-gateway/provider-core'
```

Note: `DashboardTotals` is not defined in `shared/ipc` in Task 1 — we only listed the channel. Add it to `shared/ipc.ts` under the import from `../main/database/repositories/usageRepository` and re-export it:

```ts
export type { DashboardTotals } from '../main/database/repositories/usageRepository'
```

And for `RequestUsageRow`, ensure `../main/database/types` exports it (it does).

- [ ] **Step 2: Update the renderer global typing**

`apps/desktop/src/render/src/env.d.ts` already imports `WindowApi` and declares `window.meowGateway`. It will pick up the expanded interface automatically. No change needed.

- [ ] **Step 3: Fix the renderer test mock**

`apps/desktop/src/render/src/test/setup.ts` mocks only `ping`. React views will call the new methods. Extend the mock to include all new methods as `vi.fn()` returning sensible defaults. This step is needed so render tests (from Task 4 onward) don't crash on unmocked methods:

```ts
import { vi } from 'vitest'

Object.defineProperty(window, 'meowGateway', {
  value: {
    ping: vi.fn().mockResolvedValue({ pong: 'pong', echo: '' }),
    listProviders: vi.fn().mockResolvedValue([]),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setProviderCredential: vi.fn(),
    testProviderConnection: vi.fn(),
    discoverModels: vi.fn().mockResolvedValue([]),
    listProviderTypes: vi.fn().mockResolvedValue([]),
    listModelsByProvider: vi.fn().mockResolvedValue([]),
    deleteModel: vi.fn(),
    setModelEnabled: vi.fn(),
    gatewayGetStatus: vi.fn().mockResolvedValue({ running: true, host: '127.0.0.1', port: 8317 }),
    gatewayStart: vi.fn(),
    gatewayStop: vi.fn(),
    gatewayGetConfig: vi.fn().mockResolvedValue({ id: 1, host: '127.0.0.1', port: 8317, auth_enabled: false, startup_enabled: false }),
    gatewaySaveConfig: vi.fn(),
    usageDashboardTotals: vi.fn().mockResolvedValue({ totalRequests: 0, totalTokens: 0, totalCost: null, successRequests: 0, errorRequests: 0, abortedRequests: 0, byProvider: [] }),
    usageListRecent: vi.fn().mockResolvedValue([]),
    listVirtualModels: vi.fn().mockResolvedValue([]),
    getVirtualModel: vi.fn(),
    createVirtualModel: vi.fn(),
    updateVirtualModel: vi.fn(),
    deleteVirtualModel: vi.fn()
  },
  configurable: true
})
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS (the preload now implements `WindowApi`). If `DashboardTotals` is missing, import it as shown above.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/render/src/test/setup.ts
git commit -m "feat(desktop): extend preload bridge for provider/model/gateway/usage"
```

---

### Task 3: Implement main-process IPC handlers + a provider service

**Files:**
- Create: `apps/desktop/src/main/provider/providerService.ts`
- Modify: `apps/desktop/src/main/app/bootstrap.ts`
- Test: `apps/desktop/src/main/provider/providerService.test.ts`

**Interfaces:**
- Consumes: `ProviderRepository`, `ModelRepository`, `AccountRepository`, `CredentialService`, `ProviderRegistry`, `assertSafeEndpoint`, `NewProviderInput`, `IpcResult`.
- Produces: `ProviderService` class with methods `listWithCredential()`, `create(input)`, `update(id, patch)`, `delete(id)`, `setCredential(id, secret)`, `testConnection(id)`, `discoverModels(id)`, `providerTypes()`. Also produces IPC handler registration `registerIpcHandlers` extended with provider/model/gateway/usage channels.

- [ ] **Step 1: Write the failing unit test**

Create `apps/desktop/src/main/provider/providerService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderService } from './providerService'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { ModelRepository } from '../database/repositories/modelRepository'
import type { AccountRepository } from '../database/repositories/accountRepository'
import type { CredentialService } from '../credentials/credentialService'
import type { ProviderRegistry } from '@meow-gateway/provider-core'

describe('ProviderService', () => {
  let service: ProviderService
  const providerRepo = {
    list: vi.fn().mockReturnValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', created_at: '', updated_at: '' }]),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
  const accountRepo = { listByProvider: vi.fn().mockReturnValue([]) }
  const modelRepo = { upsertByProviderModel: vi.fn() }
  const credentials = { getCredential: vi.fn().mockResolvedValue('sk-secret'), hasCredential: vi.fn(), setCredential: vi.fn(), deleteCredential: vi.fn() }
  const registry = { get: vi.fn(), list: vi.fn().mockReturnValue([]) }

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ProviderService(
      providerRepo as unknown as ProviderRepository,
      accountRepo as unknown as AccountRepository,
      modelRepo as unknown as ModelRepository,
      credentials as unknown as CredentialService,
      registry as unknown as ProviderRegistry
    )
  })

  it('listWithCredential maps hasCredential without leaking secrets', async () => {
    accountRepo.listByProvider.mockReturnValue([{ id: 'a1', provider_id: 'p1', display_name: 'Acc', credential_ref: 'ref1', status: 'active', created_at: '', updated_at: '' }])
    const rows = await service.listWithCredential()
    expect(rows).toHaveLength(1)
    expect(rows[0].hasCredential).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('sk-secret')
  })

  it('setCredential stores via credential service and links an account', async () => {
    providerRepo.findById.mockReturnValue({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', created_at: '', updated_at: '' })
    await service.setCredential('p1', 'sk-secret')
    expect(credentials.setCredential).toHaveBeenCalledWith(expect.stringContaining('p1'), 'sk-secret')
    expect(accountRepo.create).toHaveBeenCalled()
  })

  it('discoverModels calls registry adapter getModels and upserts', async () => {
    const adapter = { getModels: vi.fn().mockResolvedValue([{ id: 'm1', providerModelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: {} }]) }
    registry.get.mockReturnValue(adapter)
    providerRepo.findById.mockReturnValue({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', created_at: '', updated_at: '' })
    const models = await service.discoverModels('p1')
    expect(adapter.getModels).toHaveBeenCalled()
    expect(modelRepo.upsertByProviderModel).toHaveBeenCalled()
    expect(models).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: FAIL with "Cannot find module 'providerService'".

- [ ] **Step 3: Implement `ProviderService`**

Create `apps/desktop/src/main/provider/providerService.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { AccountRepository } from '../database/repositories/accountRepository'
import type { ModelRepository } from '../database/repositories/modelRepository'
import type { CredentialService } from '../credentials/credentialService'
import type { ProviderRegistry } from '@meow-gateway/provider-core'
import { ProviderError, assertSafeEndpoint } from '@meow-gateway/provider-core'
import type { ProviderRow, ModelRow } from '../database/types'
import type { NewProviderInput, ProviderWithCredential, ProviderTypeDescriptor } from '../../shared/ipc'

function credentialRefFor(providerId: string): string {
  // Refs must satisfy VALID_REF_RE in the credential service (/^[\w.:/-]+$/).
  return `provider:${providerId}`
}

export class ProviderService {
  constructor(
    private readonly providerRepo: ProviderRepository,
    private readonly accountRepo: AccountRepository,
    private readonly modelRepo: ModelRepository,
    private readonly credentials: CredentialService,
    private readonly registry: ProviderRegistry
  ) {}

  async listWithCredential(): Promise<ProviderWithCredential[]> {
    const providers = this.providerRepo.list()
    const result: ProviderWithCredential[] = []
    for (const p of providers) {
      const accounts = this.accountRepo.listByProvider(p.id)
      result.push({ ...p, hasCredential: accounts.length > 0 })
    }
    return result
  }

  create(input: NewProviderInput): ProviderRow {
    if (input.base_url) {
      const sr = assertSafeEndpoint(input.base_url)
      if (!sr.ok) throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${sr.reason}`, retryable: false })
    }
    return this.providerRepo.create({ type: input.type, display_name: input.display_name, base_url: input.base_url ?? null })
  }

  update(id: string, patch: Partial<Omit<ProviderRow, 'id' | 'created_at'>>): ProviderRow | undefined {
    if (patch.base_url !== undefined && patch.base_url !== null) {
      const sr = assertSafeEndpoint(patch.base_url)
      if (!sr.ok) throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${sr.reason}`, retryable: false })
    }
    return this.providerRepo.update(id, patch)
  }

  delete(id: string): boolean {
    return this.providerRepo.delete(id)
  }

  async setCredential(id: string, secret: string): Promise<void> {
    if (!this.providerRepo.findById(id)) throw new Error(`Provider not found: ${id}`)
    const ref = credentialRefFor(id)
    await this.credentials.setCredential(ref, secret)
    // Ensure an account row links the provider to the credential ref (idempotent).
    const existing = this.accountRepo.listByProvider(id)
    if (existing.length === 0) {
      this.accountRepo.create({ provider_id: id, display_name: 'Primary', credential_ref: ref, status: 'active' })
    } else {
      this.accountRepo.update(existing[0].id, { credential_ref: ref })
    }
  }

  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    const provider = this.providerRepo.findById(id)
    if (!provider) return { ok: false, message: 'Provider not found.' }
    const adapter = this.registry.get(provider.type)
    if (!adapter) return { ok: false, message: `No adapter for type: ${provider.type}` }
    const ref = credentialRefFor(id)
    const secret = await this.credentials.getCredential(ref)
    return adapter.validateCredentials({
      credentialRef: ref,
      credential: secret ?? undefined,
      baseUrl: provider.base_url ?? undefined,
      signal: new AbortController().signal,
      requestId: randomUUID()
    })
  }

  async discoverModels(id: string): Promise<import('@meow-gateway/provider-core').ModelInfo[]> {
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
    for (const m of models) {
      this.modelRepo.upsertByProviderModel({
        provider_id: id,
        provider_model_id: m.providerModelId,
        display_name: m.displayName,
        context_window: m.contextWindow ?? null,
        input_price: m.inputPrice ?? null,
        output_price: m.outputPrice ?? null,
        capabilities_json: JSON.stringify(m.capabilities)
      })
    }
    return models
  }

  providerTypes(): ProviderTypeDescriptor[] {
    const registryList = this.registry.list()
    return registryList.map((adapter) => this.describeProvider(adapter.id))
  }

  // metadata for a provider id is derived from the adapter; known ids map to
  // static descriptors, anything else falls back to a generic descriptor.
  private describeProvider(id: string): ProviderTypeDescriptor {
    const known: Record<string, ProviderTypeDescriptor> = {
      openai: { id: 'openai', displayName: 'OpenAI-Compatible', defaultBaseUrl: 'https://api.openai.com/v1', authType: 'bearer' },
      deepseek: { id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }
    }
    return known[id] ?? { id, displayName: id, defaultBaseUrl: '', authType: 'bearer' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService`
Expected: PASS.

- [ ] **Step 5: Register provider/model/gateway/usage IPC handlers in bootstrap**

Modify `apps/desktop/src/main/app/bootstrap.ts`:

- Import `ProviderService` and the `ProviderError`/`CredentialError` classes plus the new types (`NewGatewayConfig`, `ModelRow`, `ProviderRow`, `GatewayConfigRow`, `RequestUsageRow`, `GatewayStatus`, `DashboardTotals`).
- Instantiate `const providerService = new ProviderService(providerRepo, accountRepo, modelRepo, credentials, registry)`.
- Extend the `IpcHandlers` interface and `registerIpcHandlers` to accept `providerService`, `usage`, `configRepo`, `gateway`, and `usageRepo`.

Add these imports at the top of `bootstrap.ts`:

```ts
import { ProviderError, CredentialCheckResult } from '@meow-gateway/provider-core'
import { CredentialError } from '../credentials/types'
import { ProviderService } from '../provider/providerService'
import { AccountRepository } from '../database/repositories'
import type { ModelRow, ProviderRow, GatewayConfigRow, RequestUsageRow } from '../database/types'
import type { NewProviderInput, NewGatewayConfig, GatewayStatus } from '../../shared/ipc'
```

Also create the account repo in `bootstrapMeowGatewayApp` and pass it to `ProviderService`. It is not currently instantiated. Add near the other repo instantiations:

```ts
const accountRepo = new AccountRepository(db)
```

And change the `ProviderService` instantiation to include it:

```ts
const providerService = new ProviderService(providerRepo, accountRepo, modelRepo, credentials, registry)
```

Extend the interface:

```ts
interface IpcHandlers {
  repo: VirtualModelRepository
  providerRepo: ProviderRepository
  modelRepo: ModelRepository
  registry: ProviderRegistry
  providerService: ProviderService
  usage: UsageService
  usageRepo: UsageRepository
  configRepo: GatewayConfigRepository
  gateway: GatewayServer
}
```

Add new handlers inside `registerIpcHandlers`:

```ts
function registerIpcHandlers(handlers: IpcHandlers): void {
  const { repo, providerRepo, modelRepo, providerService, usage, usageRepo, configRepo, gateway } = handlers

  // Virtual-model CRUD (unchanged) ...

  // Providers
  ipcMain.handle(IPC_CHANNELS.provider.list, async (): Promise<IpcResult<ProviderWithCredential[]>> => {
    return wrap(() => providerService.listWithCredential())
  })
  ipcMain.handle(IPC_CHANNELS.provider.create, async (_e, input: NewProviderInput): Promise<IpcResult<ProviderRow>> => {
    if (!isValidNewProviderInput(input)) return badRequest('Invalid provider input.', 'INVALID_PROVIDER')
    return wrap(() => providerService.create(input))
  })
  ipcMain.handle(IPC_CHANNELS.provider.update, async (_e, id: string, patch: Record<string, unknown>): Promise<IpcResult<ProviderRow>> => {
    if (!isNonEmptyString(id) || !isObject(patch)) return badRequest('Invalid update arguments.', 'INVALID_PROVIDER')
    return wrap(() => providerService.update(id, patch))
  })
  ipcMain.handle(IPC_CHANNELS.provider.delete, async (_e, id: string): Promise<IpcResult<boolean>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_PROVIDER')
    return wrap(() => providerService.delete(id))
  })
  ipcMain.handle(IPC_CHANNELS.provider.setCredential, async (_e, id: string, secret: string): Promise<IpcResult<void>> => {
    if (!isNonEmptyString(id) || !isSecret(secret)) return badRequest('Invalid credential arguments.', 'INVALID_CREDENTIAL')
    return wrap(() => providerService.setCredential(id, secret))
  })
  ipcMain.handle(IPC_CHANNELS.provider.testConnection, async (_e, id: string): Promise<IpcResult<CredentialCheckResult>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_PROVIDER')
    return wrap(() => providerService.testConnection(id))
  })
  ipcMain.handle(IPC_CHANNELS.provider.discoverModels, async (_e, id: string): Promise<IpcResult<ModelInfo[]>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_PROVIDER')
    return wrap(() => providerService.discoverModels(id))
  })
  ipcMain.handle(IPC_CHANNELS.provider.types, async (): Promise<IpcResult<ProviderTypeDescriptor[]>> => {
    return wrap(() => providerService.providerTypes())
  })

  // Models
  ipcMain.handle(IPC_CHANNELS.model.listByProvider, async (_e, providerId: string): Promise<IpcResult<ModelRow[]>> => {
    if (!isNonEmptyString(providerId)) return badRequest('`providerId` must be a non-empty string.', 'INVALID_MODEL')
    return wrap(() => modelRepo.listByProvider(providerId))
  })
  ipcMain.handle(IPC_CHANNELS.model.delete, async (_e, id: string): Promise<IpcResult<boolean>> => {
    if (!isNonEmptyString(id)) return badRequest('`id` must be a non-empty string.', 'INVALID_MODEL')
    return wrap(() => modelRepo.delete(id))
  })
  ipcMain.handle(IPC_CHANNELS.model.setEnabled, async (_e, id: string, enabled: boolean): Promise<IpcResult<ModelRow>> => {
    if (!isNonEmptyString(id) || typeof enabled !== 'boolean') return badRequest('Invalid model toggle arguments.', 'INVALID_MODEL')
    return wrap(() => modelRepo.update(id, { enabled }))
  })

  // Gateway
  ipcMain.handle(IPC_CHANNELS.gateway.getStatus, async (): Promise<IpcResult<GatewayStatus>> => {
    return wrap(() => ({ running: !!gateway.listener(), host: DEFAULT_HOST, port: gateway.getPort() }))
  })
  ipcMain.handle(IPC_CHANNELS.gateway.start, async (): Promise<IpcResult<GatewayStatus>> => {
    return wrap(async () => { const a = await gateway.start(); return { running: true, host: a.host, port: a.port } })
  })
  ipcMain.handle(IPC_CHANNELS.gateway.stop, async (): Promise<IpcResult<GatewayStatus>> => {
    return wrap(async () => { await gateway.stop(); return { running: false, host: DEFAULT_HOST, port: gateway.getPort() } })
  })
  ipcMain.handle(IPC_CHANNELS.gateway.getConfig, async (): Promise<IpcResult<GatewayConfigRow>> => {
    return wrap(() => configRepo.get())
  })
  ipcMain.handle(IPC_CHANNELS.gateway.saveConfig, async (_e, cfg: NewGatewayConfig): Promise<IpcResult<GatewayConfigRow>> => {
    if (!isValidGatewayConfig(cfg)) return badRequest('Invalid gateway config.', 'INVALID_GATEWAY')
    return wrap(() => configRepo.save(cfg))
  })

  // Usage
  ipcMain.handle(IPC_CHANNELS.usage.dashboardTotals, async (): Promise<IpcResult<DashboardTotals>> => {
    return wrap(() => usage.totals())
  })
  ipcMain.handle(IPC_CHANNELS.usage.listRecent, async (_e, limit: number): Promise<IpcResult<RequestUsageRow[]>> => {
    if (!isValidLimit(limit)) return badRequest('Invalid limit.', 'INVALID_USAGE')
    return wrap(() => usageRepo.list(limit))
  })
}
```

Update the `bootstrapMeowGatewayApp` call to pass `providerService`, `usage`, `configRepo`, `gateway`, and `usageRepo` (already instantiated as `usageRepo` in that scope).

Update `badRequest` to accept an optional code:

```ts
function badRequest(message: string, code = 'INVALID_VIRTUAL_MODEL'): IpcResult<never> {
  return { ok: false, error: { message, code } }
}
```

Update `wrap` to catch `ProviderError` and `CredentialError`:

```ts
async function wrap<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (err) {
    if (err instanceof VirtualModelError) {
      return { ok: false, error: { message: err.message, code: 'INVALID_VIRTUAL_MODEL' } }
    }
    if (err instanceof ProviderError) {
      return { ok: false, error: { message: err.message, code: err.type } }
    }
    if (err instanceof CredentialError) {
      return { ok: false, error: { message: err.message, code: err.code } }
    }
    return { ok: false, error: { message: err instanceof Error ? err.message : 'Unknown error', code: 'INTERNAL_ERROR' } }
  }
}
```

Add validation helpers:

```ts
function isSecret(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 8192
}

function isValidNewProviderInput(v: unknown): v is NewProviderInput {
  if (!isObject(v)) return false
  if (!isNonEmptyString(v['type']) || !isNonEmptyString(v['display_name'])) return false
  if (v['base_url'] !== undefined && v['base_url'] !== null && !isNonEmptyString(v['base_url'])) return false
  return true
}

function isValidGatewayConfig(v: unknown): v is NewGatewayConfig {
  if (!isObject(v)) return false
  if (typeof v['host'] !== 'string' || v['host'].length === 0) return false
  if (typeof v['port'] !== 'number' || !Number.isInteger(v['port']) || v['port'] < 1 || v['port'] > 65535) return false
  if (typeof v['auth_enabled'] !== 'boolean') return false
  if (typeof v['startup_enabled'] !== 'boolean') return false
  return true
}

function isValidLimit(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 500
}
```

- [ ] **Step 6: Run typecheck + tests**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/provider apps/desktop/src/main/app/bootstrap.ts
git commit -m "feat(desktop): add provider service + IPC handlers for provider/model/gateway/usage"
```

---

### Task 4: Build the React views (app shell + sidebar navigation)

**Files:**
- Modify: `apps/desktop/src/render/src/App.tsx`
- Create: `apps/desktop/src/render/src/components/Sidebar.tsx`
- Create: `apps/desktop/src/render/src/views/ProvidersView.tsx`
- Create: `apps/desktop/src/render/src/views/ModelsView.tsx`
- Create: `apps/desktop/src/render/src/views/VirtualModelsView.tsx`
- Create: `apps/desktop/src/render/src/views/GatewayView.tsx`
- Create: `apps/desktop/src/render/src/views/DashboardView.tsx`
- Test: `apps/desktop/src/render/src/App.test.tsx` (update)

**Interfaces:**
- Consumes: `window.meowGateway` methods (from Task 2).
- Produces: `App` renders a nav + active view; each view fetches its own data.

- [ ] **Step 1: Write a failing render test for navigation**

Update `apps/desktop/src/render/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the providers view by default', async () => {
    render(<App />)
    expect(await screen.findByText('Providers')).toBeTruthy()
    expect(screen.getByText('Add Provider')).toBeTruthy()
  })

  it('navigates to the gateway view', async () => {
    render(<App />)
    const btn = await screen.findByText('Gateway')
    btn.click()
    expect(await screen.findByText(/Local Gateway/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- App`
Expected: FAIL (no navigation, no views yet).

- [ ] **Step 3: Implement the app shell + sidebar**

Create `apps/desktop/src/render/src/components/Sidebar.tsx`:

```tsx
export type View = 'providers' | 'models' | 'virtualmodels' | 'gateway' | 'dashboard'

const items: Array<{ id: View; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'virtualmodels', label: 'Virtual Models' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'dashboard', label: 'Dashboard' }
]

export function Sidebar({ active, onSelect }: { active: View; onSelect: (v: View) => void }) {
  return (
    <nav style={{ width: 220, background: '#161b26', padding: 12, minHeight: '100vh', borderRight: '1px solid #2a3040' }}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onSelect(it.id)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 4,
            background: active === it.id ? '#2f3a52' : 'transparent', color: '#e6e6e6',
            border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace'
          }}
        >
          {it.label}
        </button>
      ))}
    </nav>
  )
}
```

Replace `apps/desktop/src/render/src/App.tsx`:

```tsx
import { useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { ProvidersView } from './views/ProvidersView'
import { ModelsView } from './views/ModelsView'
import { VirtualModelsView } from './views/VirtualModelsView'
import { GatewayView } from './views/GatewayView'
import { DashboardView } from './views/DashboardView'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('providers')

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0b0e14', color: '#e6e6e6', fontFamily: 'monospace' }}>
      <Sidebar active={view} onSelect={setView} />
      <main style={{ flex: 1, padding: 24 }}>
        {view === 'providers' && <ProvidersView />}
        {view === 'models' && <ModelsView />}
        {view === 'virtualmodels' && <VirtualModelsView />}
        {view === 'gateway' && <GatewayView />}
        {view === 'dashboard' && <DashboardView />}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Implement placeholder views (wired next task)**

Create each view file with a minimal shell that compiles. These will be filled with real logic in Tasks 5–9. For now each returns a heading:

```tsx
// ProvidersView.tsx
export function ProvidersView() {
  return <section><h2>Providers</h2><button>Add Provider</button></section>
}
```

Similarly for ModelsView (`<h2>Models</h2>`), VirtualModelsView (`<h2>Virtual Models</h2>`), GatewayView (`<h2>Local Gateway</h2>`), DashboardView (`<h2>Dashboard</h2>`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- App`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/src/App.tsx apps/desktop/src/render/src/components apps/desktop/src/render/src/views apps/desktop/src/render/src/App.test.tsx
git commit -m "feat(render): add app shell + sidebar navigation + view placeholders"
```

---

### Task 5: Providers view (list, add, enable/disable, delete, credential, test, discover)

**Files:**
- Modify: `apps/desktop/src/render/src/views/ProvidersView.tsx`
- Test: `apps/desktop/src/render/src/views/ProvidersView.test.tsx`

**Interfaces:**
- Consumes: `window.meowGateway.listProviders`, `createProvider`, `updateProvider`, `deleteProvider`, `setProviderCredential`, `testProviderConnection`, `discoverModels`, `listProviderTypes`.
- Produces: fully functional Providers view.

- [ ] **Step 1: Write the failing render test**

Create `apps/desktop/src/render/src/views/ProvidersView.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProvidersView } from './ProvidersView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('ProvidersView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listProviders.mockResolvedValue([
      { id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', hasCredential: true, created_at: '', updated_at: '' }
    ])
    gw.listProviderTypes.mockResolvedValue([{ id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }])
  })

  it('renders providers with hasCredential badge', async () => {
    render(<ProvidersView />)
    expect(await screen.findByText('DeepSeek')).toBeTruthy()
    expect(screen.getByText(/key set/i)).toBeTruthy()
  })

  it('does not leak the secret into the DOM', async () => {
    render(<ProvidersView />)
    await screen.findByText('DeepSeek')
    expect(document.body.textContent).not.toContain('sk-secret')
  })

  it('adds a provider and stores credential', async () => {
    gw.createProvider.mockResolvedValue({ id: 'p2', type: 'deepseek', display_name: 'DeepSeek 2', enabled: true, base_url: '', hasCredential: false, created_at: '', updated_at: '' })
    gw.listProviders.mockResolvedValue([])
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Add Provider'))
    fireEvent.change(await screen.findByLabelText(/display name/i), { target: { value: 'DeepSeek 2' } })
    fireEvent.change(await screen.findByLabelText(/api key/i), { target: { value: 'sk-secret' } })
    fireEvent.click(await screen.findByText(/Save Provider/i))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: undefined }))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p2', 'sk-secret'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- ProvidersView`
Expected: FAIL.

- [ ] **Step 3: Implement the Providers view**

Write a comprehensive component. Fetch on mount; render list; add-provider form; per-card actions. Keep the key input in a password field; never render the secret. Use plain `useState`/`useEffect`.

```tsx
import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'

export function ProvidersView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [types, setTypes] = useState<ProviderTypeDescriptor[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [p, t] = await Promise.all([window.meowGateway.listProviders(), window.meowGateway.listProviderTypes()])
    setProviders(p)
    setTypes(t)
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)))
  }, [])

  async function handleAdd(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget)
    const type = String(fd.get('type'))
    const displayName = String(fd.get('display_name'))
    const baseUrl = String(fd.get('base_url'))
    const key = String(fd.get('key'))
    try {
      const created = await window.meowGateway.createProvider({ type, display_name: displayName, base_url: baseUrl || undefined })
      if (key) await window.meowGateway.setProviderCredential(created.id, key)
      setShowForm(false)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  async function handleToggle(p: ProviderWithCredential) {
    await window.meowGateway.updateProvider(p.id, { enabled: !p.enabled })
    await refresh()
  }

  async function handleDelete(p: ProviderWithCredential) {
    await window.meowGateway.deleteProvider(p.id)
    await refresh()
  }

  async function handleTest(p: ProviderWithCredential) {
    const res = await window.meowGateway.testProviderConnection(p.id)
    alert(`${res.ok ? 'OK' : 'FAIL'}: ${res.message}`)
  }

  async function handleDiscover(p: ProviderWithCredential) {
    const models = await window.meowGateway.discoverModels(p.id)
    alert(`Discovered ${models.length} models`)
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Providers</h2>
        <button onClick={() => setShowForm(!showForm)}>Add Provider</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      {showForm && (
        <form onSubmit={handleAdd} style={{ border: '1px solid #2a3040', padding: 16, marginBottom: 16, borderRadius: 8 }}>
          <label>
            Type <select name="type" required>
              {types.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
              {types.length === 0 && <option value="deepseek">DeepSeek</option>}
            </select>
          </label>
          <label>
            Display name <input name="display_name" required aria-label="display name" />
          </label>
          <label>
            Base URL <input name="base_url" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label>
            API key <input name="key" type="password" aria-label="api key" />
          </label>
          <button type="submit">Save Provider</button>
        </form>
      )}
      {providers.map((p) => (
        <div key={p.id} style={{ border: '1px solid #2a3040', padding: 12, marginBottom: 8, borderRadius: 8 }}>
          <strong>{p.display_name}</strong> <span style={{ opacity: 0.6 }}>[{p.type}]</span>
          {p.hasCredential ? <em style={{ color: '#4caf50' }}>  ✓ key set</em> : <em style={{ color: '#ff9800' }}>  no key</em>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => handleToggle(p)}>{p.enabled ? 'Disable' : 'Enable'}</button>
            <button onClick={() => handleTest(p)}>Test</button>
            <button onClick={() => handleDiscover(p)}>Discover models</button>
            <button onClick={() => handleDelete(p)}>Delete</button>
          </div>
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- ProvidersView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/views/ProvidersView.tsx apps/desktop/src/render/src/views/ProvidersView.test.tsx
git commit -m "feat(render): implement providers view"
```

---

### Task 6: Models + Virtual Models views

**Files:**
- Create: `apps/desktop/src/render/src/views/ModelsView.tsx` (implement)
- Create: `apps/desktop/src/render/src/views/VirtualModelsView.tsx` (implement)
- Test: `apps/desktop/src/render/src/views/ModelsView.test.tsx`
- Test: `apps/desktop/src/render/src/views/VirtualModelsView.test.tsx`

**Interfaces:**
- Consumes: `window.meowGateway.listModelsByProvider`, `deleteModel`, `setModelEnabled`, `discoverModels`, `listProviders`, `listVirtualModels`, `createVirtualModel`, `updateVirtualModel`, `deleteVirtualModel`.
- Produces: functional Models and Virtual Models views.

- [ ] **Step 1: Write failing tests**

`ModelsView.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelsView } from './ModelsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('ModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
    gw.listModelsByProvider.mockResolvedValue([{ id: 'm1', provider_id: 'p1', provider_model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: 64000, input_price: 0.1, output_price: 0.3, capabilities_json: '{}', enabled: true, discovered_at: '' }])
  })

  it('renders models for selected provider', async () => {
    render(<ModelsView />)
    expect(await screen.findByText('DeepSeek Chat')).toBeTruthy()
  })

  it('refreshes models', async () => {
    gw.discoverModels.mockResolvedValue([{ id: 'm1', providerModelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: {} }])
    render(<ModelsView />)
    fireEvent.click(await screen.findByText(/Refresh models/i))
    await waitFor(() => expect(gw.discoverModels).toHaveBeenCalledWith('p1'))
  })
})
```

`VirtualModelsView.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VirtualModelsView } from './VirtualModelsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('VirtualModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listVirtualModels.mockResolvedValue([{ id: 'vm1', display_name: 'meow-coding', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' }])
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
  })

  it('renders virtual models', async () => {
    render(<VirtualModelsView />)
    expect(await screen.findByText('meow-coding')).toBeTruthy()
  })

  it('creates a virtual model', async () => {
    gw.createVirtualModel.mockResolvedValue({ id: 'vm2', display_name: 'my-model', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' })
    render(<VirtualModelsView />)
    fireEvent.click(await screen.findByText(/New Virtual Model/i))
    fireEvent.change(await screen.findByLabelText(/display name/i), { target: { value: 'my-model' } })
    fireEvent.change(await screen.findByLabelText(/provider model id/i), { target: { value: 'deepseek-chat' } })
    fireEvent.click(await screen.findByText(/Save/i))
    await waitFor(() => expect(gw.createVirtualModel).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @meow-gateway/desktop test -- ModelsView VirtualModelsView`
Expected: FAIL.

- [ ] **Step 3: Implement Models view**

```tsx
import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ModelRow } from '@shared/ipc'

export function ModelsView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = async (pid: string) => {
    if (!pid) { setModels([]); return }
    const rows = await window.meowGateway.listModelsByProvider(pid)
    setModels(rows)
  }

  useEffect(() => {
    window.meowGateway.listProviders().then((p) => {
      setProviders(p)
      if (p.length > 0) { setProviderId(p[0].id); refresh(p[0].id) }
    }).catch((e) => setError(String(e)))
  }, [])

  async function handleRefresh() {
    await window.meowGateway.discoverModels(providerId)
    await refresh(providerId)
  }

  async function handleToggle(m: ModelRow) {
    await window.meowGateway.setModelEnabled(m.id, !m.enabled)
    await refresh(providerId)
  }

  async function handleDelete(m: ModelRow) {
    await window.meowGateway.deleteModel(m.id)
    await refresh(providerId)
  }

  return (
    <section>
      <h2>Models</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={providerId} onChange={(e) => { setProviderId(e.target.value); refresh(e.target.value) }}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <button onClick={handleRefresh}>Refresh models</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Name</th><th>Model ID</th><th>Context</th><th>In</th><th>Out</th><th>Enabled</th></tr></thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid #2a3040' }}>
              <td>{m.display_name}</td>
              <td>{m.provider_model_id}</td>
              <td>{m.context_window ?? '-'}</td>
              <td>{m.input_price ?? '-'}</td>
              <td>{m.output_price ?? '-'}</td>
              <td><button onClick={() => handleToggle(m)}>{m.enabled ? 'Disable' : 'Enable'}</button></td>
              <td><button onClick={() => handleDelete(m)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: Implement Virtual Models view**

```tsx
import { useEffect, useState } from 'react'
import type { ProviderWithCredential, VirtualModelRow } from '@shared/ipc'

export function VirtualModelsView() {
  const [vms, setVms] = useState<VirtualModelRow[]>([])
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [v, p] = await Promise.all([window.meowGateway.listVirtualModels(), window.meowGateway.listProviders()])
    setVms(v); setProviders(p)
  }

  useEffect(() => { refresh().catch((e) => setError(String(e))) }, [])

  async function handleAdd(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget)
    try {
      await window.meowGateway.createVirtualModel({
        display_name: String(fd.get('display_name')),
        provider_id: String(fd.get('provider_id')),
        provider_model_id: String(fd.get('provider_model_id')),
        routing_policy_id: null
      })
      setShowForm(false)
      await refresh()
    } catch (e) { setError(String(e)) }
  }

  async function handleDelete(vm: VirtualModelRow) {
    await window.meowGateway.deleteVirtualModel(vm.id)
    await refresh()
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Virtual Models</h2>
        <button onClick={() => setShowForm(!showForm)}>New Virtual Model</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      {showForm && (
        <form onSubmit={handleAdd} style={{ border: '1px solid #2a3040', padding: 16, marginBottom: 16, borderRadius: 8 }}>
          <label>Display name <input name="display_name" required aria-label="display name" /></label>
          <label>Provider <select name="provider_id" required>{providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
          <label>Provider model id <input name="provider_model_id" required aria-label="provider model id" /></label>
          <button type="submit">Save</button>
        </form>
      )}
      {vms.map((vm) => (
        <div key={vm.id} style={{ border: '1px solid #2a3040', padding: 12, marginBottom: 8, borderRadius: 8 }}>
          <strong>{vm.display_name}</strong> → {vm.provider_id}/{vm.provider_model_id}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => handleDelete(vm)}>Delete</button>
            <button onClick={() => window.meowGateway.updateVirtualModel(vm.id, { enabled: !vm.enabled })}>{vm.enabled ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @meow-gateway/desktop test -- ModelsView VirtualModelsView`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/src/views/ModelsView.tsx apps/desktop/src/render/src/views/VirtualModelsView.tsx apps/desktop/src/render/src/views/ModelsView.test.tsx apps/desktop/src/render/src/views/VirtualModelsView.test.tsx
git commit -m "feat(render): implement models + virtual models views"
```

---

### Task 7: Gateway view

**Files:**
- Create: `apps/desktop/src/render/src/views/GatewayView.tsx` (implement)
- Test: `apps/desktop/src/render/src/views/GatewayView.test.tsx`

**Interfaces:**
- Consumes: `window.meowGateway.gatewayGetStatus`, `gatewayStart`, `gatewayStop`, `gatewayGetConfig`, `gatewaySaveConfig`.
- Produces: functional Gateway view.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GatewayView } from './GatewayView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('GatewayView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.gatewayGetStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 8317 })
    gw.gatewayGetConfig.mockResolvedValue({ id: 1, host: '127.0.0.1', port: 8317, auth_enabled: false, startup_enabled: false })
  })

  it('shows running status and host:port', async () => {
    render(<GatewayView />)
    expect(await screen.findByText(/127.0.0.1:8317/)).toBeTruthy()
  })

  it('stops the gateway', async () => {
    gw.gatewayStop.mockResolvedValue({ running: false, host: '127.0.0.1', port: 8317 })
    render(<GatewayView />)
    fireEvent.click(await screen.findByText(/Stop/))
    await waitFor(() => expect(gw.gatewayStop).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- GatewayView`
Expected: FAIL.

- [ ] **Step 3: Implement the Gateway view**

```tsx
import { useEffect, useState } from 'react'
import type { GatewayStatus, GatewayConfigRow } from '@shared/ipc'

export function GatewayView() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [config, setConfig] = useState<GatewayConfigRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [s, c] = await Promise.all([window.meowGateway.gatewayGetStatus(), window.meowGateway.gatewayGetConfig()])
    setStatus(s); setConfig(c)
  }

  useEffect(() => { refresh().catch((e) => setError(String(e))) }, [])

  async function handleStart() { setStatus(await window.meowGateway.gatewayStart()) }
  async function handleStop() { setStatus(await window.meowGateway.gatewayStop()) }

  async function handleSave(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget)
    const port = Number(fd.get('port'))
    try {
      const saved = await window.meowGateway.gatewaySaveConfig({
        host: String(fd.get('host')),
        port,
        auth_enabled: fd.get('auth_enabled') === 'on',
        startup_enabled: fd.get('startup_enabled') === 'on'
      })
      setConfig(saved)
    } catch (e) { setError(String(e)) }
  }

  if (!status || !config) return <section><h2>Local Gateway</h2><p>Loading…</p></section>

  return (
    <section>
      <h2>Local Gateway</h2>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <div style={{ marginBottom: 16 }}>
        <strong>{status.running ? 'Running' : 'Stopped'}</strong> — {status.host}:{status.port}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={handleStart}>Start</button>
        <button onClick={handleStop}>Stop</button>
      </div>
      <form onSubmit={handleSave} style={{ border: '1px solid #2a3040', padding: 16, borderRadius: 8 }}>
        <label>Host <input name="host" defaultValue={config.host} /></label>
        <label>Port <input name="port" type="number" defaultValue={config.port} /></label>
        <label><input name="auth_enabled" type="checkbox" defaultChecked={config.auth_enabled} /> Auth enabled</label>
        <label><input name="startup_enabled" type="checkbox" defaultChecked={config.startup_enabled} /> Startup enabled</label>
        <button type="submit">Save config</button>
      </form>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- GatewayView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/views/GatewayView.tsx apps/desktop/src/render/src/views/GatewayView.test.tsx
git commit -m "feat(render): implement gateway view"
```

---

### Task 8: Dashboard view (usage + cost)

**Files:**
- Create: `apps/desktop/src/render/src/views/DashboardView.tsx` (implement)
- Test: `apps/desktop/src/render/src/views/DashboardView.test.tsx`

**Interfaces:**
- Consumes: `window.meowGateway.usageDashboardTotals`, `usageListRecent`.
- Produces: functional Dashboard view.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardView } from './DashboardView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.usageDashboardTotals.mockResolvedValue({
      totalRequests: 10, totalTokens: 1000, totalCost: 0.25,
      successRequests: 9, errorRequests: 1, abortedRequests: 0,
      byProvider: [{ provider_id: 'deepseek', request_count: 10, total_cost: 0.25 }]
    })
    gw.usageListRecent.mockResolvedValue([
      { id: 'u1', request_id: 'r1', virtual_model_id: 'vm1', provider_id: 'deepseek', provider_model_id: 'deepseek-chat', input_tokens: 100, output_tokens: 50, cached_tokens: 0, estimated_cost: 0.01, latency_ms: 500, status: 'success', error_code: null, route_attempt: 0, created_at: '2026-01-01T00:00:00Z' }
    ])
  })

  it('renders totals', async () => {
    render(<DashboardView />)
    expect(await screen.findByText('10')).toBeTruthy()
    expect(screen.getByText(/0.25/)).toBeTruthy()
  })

  it('renders recent requests', async () => {
    render(<DashboardView />)
    expect(await screen.findByText(/r1/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- DashboardView`
Expected: FAIL.

- [ ] **Step 3: Implement the Dashboard view**

```tsx
import { useEffect, useState } from 'react'
import type { DashboardTotals, RequestUsageRow } from '@shared/ipc'

export function DashboardView() {
  const [totals, setTotals] = useState<DashboardTotals | null>(null)
  const [recent, setRecent] = useState<RequestUsageRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.meowGateway.usageDashboardTotals(), window.meowGateway.usageListRecent(50)])
      .then(([t, r]) => { setTotals(t); setRecent(r) })
      .catch((e) => setError(String(e)))
  }, [])

  if (!totals) return <section><h2>Dashboard</h2><p>Loading…</p></section>

  return (
    <section>
      <h2>Dashboard</h2>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.totalRequests}</strong><div>Requests</div></div>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.totalTokens}</strong><div>Tokens</div></div>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.totalCost ?? 0}</strong><div>Est. Cost</div></div>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.successRequests}/{totals.errorRequests}/{totals.abortedRequests}</strong><div>Success/Error/Aborted</div></div>
      </div>
      <h3>By provider</h3>
      <ul>{totals.byProvider.map((bp) => <li key={bp.provider_id}>{bp.provider_id}: {bp.request_count} ({bp.total_cost ?? 0})</li>)}</ul>
      <h3>Recent requests</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Request ID</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Status</th></tr></thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid #2a3040' }}>
              <td>{r.request_id}</td><td>{r.provider_model_id}</td><td>{r.input_tokens + r.output_tokens + r.cached_tokens}</td><td>{r.estimated_cost ?? 0}</td><td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- DashboardView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/views/DashboardView.tsx apps/desktop/src/render/src/views/DashboardView.test.tsx
git commit -m "feat(render): implement dashboard view"
```

---

### Task 9: Integration + security tests, docs update, full verification

**Files:**
- Create: `apps/desktop/src/main/provider/providerService.security.test.ts`
- Modify: docs as needed (e.g. `README.md` if behavior/contract changed — likely not needed for UI-only changes).
- Test: run full suite.

**Interfaces:**
- Consumes: `ProviderService` with a mock registry and credential service.
- Produces: security guarantees confirmed.

- [ ] **Step 1: Write the failing security test**

Create `apps/desktop/src/main/provider/providerService.security.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderService } from './providerService'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { ModelRepository } from '../database/repositories/modelRepository'
import type { AccountRepository } from '../database/repositories/accountRepository'
import type { CredentialService } from '../credentials/credentialService'
import type { ProviderRegistry } from '@meow-gateway/provider-core'

describe('ProviderService security', () => {
  let service: ProviderService
  const providerRepo = { list: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
  const accountRepo = { listByProvider: vi.fn().mockReturnValue([]), create: vi.fn(), update: vi.fn() }
  const modelRepo = { upsertByProviderModel: vi.fn() }
  const credentials = { getCredential: vi.fn(), hasCredential: vi.fn(), setCredential: vi.fn(), deleteCredential: vi.fn() }
  const registry = { get: vi.fn(), list: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ProviderService(
      providerRepo as unknown as ProviderRepository,
      accountRepo as unknown as AccountRepository,
      modelRepo as unknown as ModelRepository,
      credentials as unknown as CredentialService,
      registry as unknown as ProviderRegistry
    )
  })

  it('never returns the secret in listWithCredential', async () => {
    providerRepo.list.mockReturnValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', created_at: '', updated_at: '' }])
    accountRepo.listByProvider.mockReturnValue([{ id: 'a1', provider_id: 'p1', display_name: 'Acc', credential_ref: 'ref', status: 'active', created_at: '', updated_at: '' }])
    const rows = await service.listWithCredential()
    expect(JSON.stringify(rows)).not.toContain('sk-secret')
  })

  it('rejects an unsafe SSRF base URL', () => {
    expect(() => service.create({ type: 'deepseek', display_name: 'x', base_url: 'http://169.254.169.254' })).toThrow()
  })

  it('calls validateCredentials with a resolved credential only in main', async () => {
    providerRepo.findById.mockReturnValue({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', created_at: '', updated_at: '' })
    const adapter = { validateCredentials: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }) }
    registry.get.mockReturnValue(adapter)
    credentials.getCredential.mockResolvedValue('sk-secret')
    await service.testConnection('p1')
    expect(adapter.validateCredentials).toHaveBeenCalled()
    expect(credentials.getCredential).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the security test**

Run: `pnpm --filter @meow-gateway/desktop test -- providerService.security`
Expected: PASS.

- [ ] **Step 3: Run the full suite, typecheck, lint**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop lint && pnpm --filter @meow-gateway/desktop test`
Expected: PASS.

- [ ] **Step 4: Verify no secrets in logs/tests/fixtures**

Search the source for any hard-coded real keys or `sk-` literals in render files:

Run: `grep -rn "sk-" apps/desktop/src/render apps/desktop/src/main | grep -v test || echo "clean"`
Expected: no output (or only in test fixtures using a fake key like `sk-secret` for deterministic assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/provider/providerService.security.test.ts
git commit -m "test(desktop): add provider service security tests"
```

---

### Task 10: Final review against spec acceptance criteria

**Files:**
- None (review only).

**Interfaces:**
- N/A.

- [ ] **Step 1: Walk the spec Definition of Done**

Verify each item from `docs/superpowers/specs/2026-08-29-provider-management-dashboard-ui-design.md` §10:

- Preload `WindowApi` extended and implemented — Task 2.
- All five views present and functional — Tasks 5–8.
- Add/remove/enable/disable provider works; key stored securely; no key in renderer DOM/state — Task 5 + security tests.
- Test connectivity + discover models work — Task 3 + Task 5.
- Virtual model CRUD works — Task 6.
- Gateway start/stop/config works — Task 7.
- Dashboard totals + recent requests render — Task 8.
- Unit + integration tests pass; typecheck + lint pass; no secrets — Task 9.
- Docs updated if contracts changed — verified in Task 9.

- [ ] **Step 2: Run the full verification once more**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(desktop): final verification for provider-management dashboard UI"
```
