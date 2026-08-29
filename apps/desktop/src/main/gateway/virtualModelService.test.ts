// Tests for VirtualModelService: resolves client model ids, lists enabled models,
// and rejects disabled/unknown virtual models (T401).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from '../database/connection'
import { ProviderRepository, ModelRepository, VirtualModelRepository, RoutingPolicyRepository } from '../database/repositories'
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

  it("carries the provider's configured base URL onto the resolved model", async () => {
    // The adapter falls back to its own DEFAULT_BASE_URL when this is missing,
    // sending a request meant for one vendor's endpoint to another's.
    const providerRepo = new ProviderRepository(db)
    providerRepo.create({
      id: 'opencode',
      type: 'opencode',
      display_name: 'opencode Zen',
      base_url: 'https://opencode.ai/zen/go/v1'
    })
    new ModelRepository(db).create({
      provider_id: 'opencode',
      provider_model_id: 'deepseek-v4-flash-vision-exp',
      display_name: 'vision'
    })
    repo.create({
      display_name: 'meo-ds-v4-flash-vision',
      provider_id: 'opencode',
      provider_model_id: 'deepseek-v4-flash-vision-exp'
    })
    const withProviders = new VirtualModelService(repo, null, providerRepo)
    const resolved = await withProviders.resolveModel('meo-ds-v4-flash-vision')
    expect(resolved!.baseUrl).toBe('https://opencode.ai/zen/go/v1')
  })

  it("carries the provider TYPE as the adapter registry key when the provider id is a UUID", async () => {
    // Real providers store a UUID as provider.id; the adapter registry is keyed
    // by type ('deepseek'), so the route must expose the type separately from
    // the UUID or the gateway fails with INTERNAL_ERROR.
    const providerRepo = new ProviderRepository(db)
    providerRepo.create({ id: 'cbdad16d-0beb-4f60-aa10-bdbbf22e8929', type: 'deepseek', display_name: 'DeepSeek' })
    new ModelRepository(db).create({
      provider_id: 'cbdad16d-0beb-4f60-aa10-bdbbf22e8929',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat'
    })
    repo.create({
      display_name: 'meo-ds-01',
      provider_id: 'cbdad16d-0beb-4f60-aa10-bdbbf22e8929',
      provider_model_id: 'deepseek-chat'
    })
    const withProviders = new VirtualModelService(repo, null, providerRepo)
    const resolved = await withProviders.resolveModel('meo-ds-01')
    expect(resolved!.providerId).toBe('cbdad16d-0beb-4f60-aa10-bdbbf22e8929')
    expect(resolved!.adapterId).toBe('deepseek')
  })

  it('leaves the base URL unset when the provider has none', async () => {
    const providerRepo = new ProviderRepository(db)
    repo.create({ display_name: 'plain', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    const withProviders = new VirtualModelService(repo, null, providerRepo)
    const resolved = await withProviders.resolveModel('plain')
    expect(resolved!.baseUrl).toBeUndefined()
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

describe('VirtualModelService.resolveRoutes (T701)', () => {
  let db: PersistedConnection
  let vmRepo: VirtualModelRepository
  let policyRepo: RoutingPolicyRepository
  let service: VirtualModelService

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    const providerRepo = new ProviderRepository(db)
    const modelRepo = new ModelRepository(db)
    vmRepo = new VirtualModelRepository(db)
    policyRepo = new RoutingPolicyRepository(db)
    providerRepo.create({ id: 'deepseek', type: 'deepseek', display_name: 'DeepSeek' })
    providerRepo.create({ id: 'openai', type: 'openai', display_name: 'OpenAI' })
    modelRepo.create({ provider_id: 'deepseek', provider_model_id: 'deepseek-chat', display_name: 'D' })
    modelRepo.create({ provider_id: 'openai', provider_model_id: 'gpt-4o', display_name: 'G' })
    service = new VirtualModelService(vmRepo, policyRepo)
  })

  afterEach(() => closeDatabase(db))

  it('returns a single primary route when no policy is attached', async () => {
    vmRepo.create({ display_name: 'meow-coding', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    const rl = await service.resolveRoutes('meow-coding')
    expect(rl.routes).toEqual([{ providerId: 'deepseek', providerModelId: 'deepseek-chat' }])
    expect(rl.usedFallback).toBe(false)
  })

  it('prepends the primary route and appends policy candidates', async () => {
    const policy = policyRepo.create({
      name: 'fb',
      config_json: JSON.stringify([{ providerId: 'openai', providerModelId: 'gpt-4o' }])
    })
    vmRepo.create({
      display_name: 'meow-coding',
      provider_id: 'deepseek',
      provider_model_id: 'deepseek-chat',
      routing_policy_id: policy.id
    })
    const rl = await service.resolveRoutes('meow-coding')
    expect(rl.routes).toEqual([
      { providerId: 'deepseek', providerModelId: 'deepseek-chat' },
      { providerId: 'openai', providerModelId: 'gpt-4o' }
    ])
    expect(rl.usedFallback).toBe(true)
  })

  it('dedupes a candidate that repeats the primary provider (loop prevention)', async () => {
    const policy = policyRepo.create({
      name: 'fb',
      config_json: JSON.stringify([
        { providerId: 'deepseek', providerModelId: 'deepseek-chat' },
        { providerId: 'openai', providerModelId: 'gpt-4o' }
      ])
    })
    vmRepo.create({
      display_name: 'meow-coding',
      provider_id: 'deepseek',
      provider_model_id: 'deepseek-chat',
      routing_policy_id: policy.id
    })
    const rl = await service.resolveRoutes('meow-coding')
    expect(rl.routes).toEqual([
      { providerId: 'deepseek', providerModelId: 'deepseek-chat' },
      { providerId: 'openai', providerModelId: 'gpt-4o' }
    ])
  })

  it('returns empty routes for an unknown or disabled virtual model', async () => {
    expect((await service.resolveRoutes('nope')).routes).toEqual([])
    vmRepo.create({ display_name: 'off', provider_id: 'openai', provider_model_id: 'gpt-4o', enabled: false })
    expect((await service.resolveRoutes('off')).routes).toEqual([])
  })
})
