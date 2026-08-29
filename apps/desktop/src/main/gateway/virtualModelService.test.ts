// Tests for VirtualModelService: resolves client model ids, lists enabled models,
// and rejects disabled/unknown virtual models (T401).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from '../database/connection'
import { ProviderRepository, ModelRepository, VirtualModelRepository } from '../database/repositories'
import { VirtualModelService } from './virtualModelService'

describe('VirtualModelService', () => {
  let db: PersistedConnection
  let repo: VirtualModelRepository
  let service: VirtualModelService

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    const providerRepo = new ProviderRepository(db)
    const modelRepo = new ModelRepository(db)
    repo = new VirtualModelRepository(db)
    providerRepo.create({ id: 'deepseek', type: 'deepseek', display_name: 'DeepSeek' })
    providerRepo.create({ id: 'openai', type: 'openai', display_name: 'OpenAI' })
    modelRepo.create({ provider_id: 'deepseek', provider_model_id: 'deepseek-chat', display_name: 'D' })
    modelRepo.create({ provider_id: 'openai', provider_model_id: 'gpt-4o', display_name: 'G' })
    service = new VirtualModelService(repo)
  })

  afterEach(() => closeDatabase(db))

  it('resolves a virtual model display name to a provider model', async () => {
    repo.create({ display_name: 'meow-coding', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    const resolved = await service.resolveModel('meow-coding')
    expect(resolved).toBeTruthy()
    expect(resolved!.providerId).toBe('deepseek')
    expect(resolved!.providerModelId).toBe('deepseek-chat')
    expect(resolved!.model.id).toBe('deepseek-chat')
  })

  it('returns null for an unknown virtual model', async () => {
    expect(await service.resolveModel('nope')).toBeNull()
  })

  it('returns null for a disabled virtual model', async () => {
    repo.create({ display_name: 'off', provider_id: 'openai', provider_model_id: 'gpt-4o', enabled: false })
    expect(await service.resolveModel('off')).toBeNull()
  })

  it('lists enabled virtual models as OpenAI model descriptors', async () => {
    repo.create({ display_name: 'meow-coding', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    repo.create({ display_name: 'off', provider_id: 'openai', provider_model_id: 'gpt-4o', enabled: false })
    const models = await service.listModels()
    expect(models.length).toBe(1)
    expect(models[0].id).toBe('meow-coding')
    expect(models[0].object).toBe('model')
    expect(models[0].owned_by).toBe('meow-gateway')
  })
})
