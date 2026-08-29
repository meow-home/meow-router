// Tests for VirtualModelRepository CRUD, validation, enable/disable (T401).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from '../connection'
import { ProviderRepository, ModelRepository, VirtualModelRepository, VirtualModelError } from './index'

describe('VirtualModelRepository', () => {
  let db: PersistedConnection
  let providerRepo: ProviderRepository
  let modelRepo: ModelRepository
  let repo: VirtualModelRepository

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    providerRepo = new ProviderRepository(db)
    modelRepo = new ModelRepository(db)
    repo = new VirtualModelRepository(db)

    // Seed a provider and model so validation passes.
    providerRepo.create({ id: 'deepseek', type: 'deepseek', display_name: 'DeepSeek' })
    providerRepo.create({ id: 'openai', type: 'openai', display_name: 'OpenAI' })
    modelRepo.create({
      provider_id: 'deepseek',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat'
    })
    modelRepo.create({
      provider_id: 'openai',
      provider_model_id: 'gpt-4o',
      display_name: 'GPT-4o'
    })
  })

  afterEach(() => closeDatabase(db))

  it('creates and reads back a virtual model', () => {
    const vm = repo.create({
      display_name: 'meow-coding',
      provider_id: 'deepseek',
      provider_model_id: 'deepseek-chat'
    })
    expect(vm.id).toBeTruthy()
    expect(vm.display_name).toBe('meow-coding')
    expect(vm.provider_id).toBe('deepseek')
    expect(vm.provider_model_id).toBe('deepseek-chat')
    expect(vm.enabled).toBe(true)

    const found = repo.findById(vm.id)
    expect(found).toBeDefined()
    expect(found!.display_name).toBe('meow-coding')
    // Also findable by display name (client-facing id).
    expect(repo.findByDisplayName('meow-coding')?.id).toBe(vm.id)
  })

  it('rejects an unknown provider', () => {
    expect(() =>
      repo.create({ display_name: 'bad', provider_id: 'nope', provider_model_id: 'x' })
    ).toThrow(VirtualModelError)
  })

  it('rejects a provider model the provider does not have', () => {
    expect(() =>
      repo.create({ display_name: 'bad', provider_id: 'deepseek', provider_model_id: 'gpt-4o' })
    ).toThrow(VirtualModelError)
  })

  it('rejects an invalid display name', () => {
    expect(() =>
      repo.create({ display_name: 'has spaces', provider_id: 'deepseek', provider_model_id: 'deepseek-chat' })
    ).toThrow(VirtualModelError)
  })

  it('lists only enabled virtual models', () => {
    repo.create({ display_name: 'one', provider_id: 'openai', provider_model_id: 'gpt-4o' })
    repo.create({ display_name: 'two', provider_id: 'deepseek', provider_model_id: 'deepseek-chat', enabled: false })
    const enabled = repo.listEnabled()
    expect(enabled.map((v) => v.display_name)).toEqual(['one'])
  })

  it('enable/disable toggles availability', () => {
    const vm = repo.create({ display_name: 'toggle', provider_id: 'openai', provider_model_id: 'gpt-4o' })
    repo.setEnabled(vm.id, false)
    expect(repo.findById(vm.id)!.enabled).toBe(false)
    expect(repo.listEnabled().map((v) => v.display_name)).not.toContain('toggle')
    repo.setEnabled(vm.id, true)
    expect(repo.findById(vm.id)!.enabled).toBe(true)
  })

  it('update changes mapping without changing the id', () => {
    const vm = repo.create({ display_name: 'coding', provider_id: 'openai', provider_model_id: 'gpt-4o' })
    const updated = repo.update(vm.id, { provider_model_id: 'deepseek-chat', provider_id: 'deepseek' })
    expect(updated).toBeDefined()
    expect(updated!.provider_id).toBe('deepseek')
    expect(updated!.provider_model_id).toBe('deepseek-chat')
    expect(updated!.id).toBe(vm.id)
  })

  it('delete removes the virtual model', () => {
    const vm = repo.create({ display_name: 'gone', provider_id: 'openai', provider_model_id: 'gpt-4o' })
    expect(repo.delete(vm.id)).toBe(true)
    expect(repo.findById(vm.id)).toBeUndefined()
    expect(repo.delete(vm.id)).toBe(false)
  })
})
