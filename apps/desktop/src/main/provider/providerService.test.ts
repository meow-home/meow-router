import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderService } from './providerService'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { ModelRepository } from '../database/repositories/modelRepository'
import type { AccountRepository } from '../database/repositories/accountRepository'
import type { CredentialService } from '../credentials/credentialService'
import type { ProviderRegistry } from '@meow-gateway/provider-core'

const providerRow = {
  id: 'p1',
  type: 'deepseek',
  display_name: 'DeepSeek',
  enabled: true,
  base_url: 'https://api.deepseek.com/v1',
  created_at: '',
  updated_at: ''
}
const accountRow = {
  id: 'a1',
  provider_id: 'p1',
  display_name: 'Acc',
  credential_ref: 'provider:p1',
  status: 'active',
  created_at: '',
  updated_at: ''
}

describe('ProviderService', () => {
  let service: ProviderService
  const providerRepo = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
  const accountRepo = { listByProvider: vi.fn().mockReturnValue([]), create: vi.fn(), update: vi.fn() }
  const modelRepo = { upsertByProviderModel: vi.fn(), findByProviderModel: vi.fn(), listByProvider: vi.fn(), update: vi.fn() }
  const credentials = {
    getCredential: vi.fn().mockResolvedValue('sk-secret'),
    hasCredential: vi.fn(),
    setCredential: vi.fn(),
    deleteCredential: vi.fn()
  }
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
    providerRepo.list.mockReturnValue([providerRow])
    accountRepo.listByProvider.mockReturnValue([accountRow])
    const rows = await service.listWithCredential()
    expect(rows).toHaveLength(1)
    expect(rows[0].hasCredential).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('sk-secret')
  })

  it('setCredential stores via credential service and links an account', async () => {
    providerRepo.findById.mockReturnValue(providerRow)
    accountRepo.listByProvider.mockReturnValue([])
    await service.setCredential('p1', 'sk-secret')
    expect(credentials.setCredential).toHaveBeenCalledWith('provider:p1', 'sk-secret')
    expect(accountRepo.create).toHaveBeenCalled()
  })

  it('setCredential updates the existing account ref when one exists', async () => {
    providerRepo.findById.mockReturnValue(providerRow)
    accountRepo.listByProvider.mockReturnValue([accountRow])
    await service.setCredential('p1', 'sk-secret')
    expect(accountRepo.update).toHaveBeenCalledWith('a1', { credential_ref: 'provider:p1' })
    expect(accountRepo.create).not.toHaveBeenCalled()
  })

  it('discoverModels calls registry adapter getModels and upserts', async () => {
    const adapter = {
      getModels: vi.fn().mockResolvedValue([
        { id: 'm1', providerModelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: {} }
      ])
    }
    registry.get.mockReturnValue(adapter)
    providerRepo.findById.mockReturnValue(providerRow)
    modelRepo.listByProvider.mockReturnValue([])
    const models = await service.discoverModels('p1')
    expect(adapter.getModels).toHaveBeenCalled()
    expect(modelRepo.upsertByProviderModel).toHaveBeenCalled()
    expect(models).toHaveLength(1)
  })

  it('safe upsert preserves enabled and marks stale for missing models', async () => {
    const adapter = { id: 'deepseek', getModels: vi.fn().mockResolvedValue([
      { id: 'a', providerModelId: 'a', displayName: 'A', capabilities: { streaming: true, tools: false, vision: false, reasoning: false, structuredOutput: false } }
    ]) }
    registry.get.mockReturnValue(adapter)
    credentials.getCredential.mockResolvedValue('secret')
    providerRepo.findById.mockReturnValue(providerRow)
    // A pre-existing model 'a' that the user has explicitly disabled; it IS in the API response,
    // so discoverModels must upsert it while preserving the disabled status (NOT forcing true).
    modelRepo.findByProviderModel.mockReturnValue({ id: 'm1', provider_id: 'p1', provider_model_id: 'a', display_name: 'A', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: false, discovered_at: '', stale: false })
    // pre-existing model 'b' is present locally but won't be in the API response
    modelRepo.listByProvider.mockReturnValue([
      { id: 'm1', provider_id: 'p1', provider_model_id: 'a', display_name: 'A', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: false, discovered_at: '', stale: false },
      { id: 'm2', provider_id: 'p1', provider_model_id: 'b', display_name: 'B', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: false, discovered_at: '', stale: false }
    ])
    modelRepo.upsertByProviderModel.mockImplementation((input) => ({ ...(input as object), id: 'm1', enabled: true, discovered_at: '', stale: false }) as never)
    modelRepo.update.mockImplementation((id, patch) => ({ id, ...patch, stale: patch.stale ?? false } as never))

    await service.discoverModels('p1')

    expect(modelRepo.update).toHaveBeenCalledWith('m2', { stale: true })
    // The model present in the API response was upserted; its user choice (disabled) was preserved.
    expect(modelRepo.upsertByProviderModel).toHaveBeenCalledWith(expect.objectContaining({ provider_model_id: 'a', enabled: false }))
  })

  it('rejects an unsafe SSRF base URL on create', () => {
    expect(() => service.create({ type: 'deepseek', display_name: 'x', base_url: 'http://169.254.169.254' })).toThrow()
  })

  it('providerTypes returns descriptors for registered adapters', () => {
    registry.list.mockReturnValue([{ id: 'deepseek' }])
    const types = service.providerTypes()
    expect(types).toHaveLength(1)
    expect(types[0].id).toBe('deepseek')
    expect(types[0].displayName).toBe('DeepSeek')
  })
})
