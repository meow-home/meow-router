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
