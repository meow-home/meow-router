// Tests for ModelRepository CRUD, upsert and enable/disable (Phase 2 UI support).
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from '../connection'
import { ModelRepository } from './modelRepository'

describe('ModelRepository', () => {
  let db: PersistedConnection
  let repo: ModelRepository

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new ModelRepository(db)
  })

  it('creates and finds a model by provider model id', () => {
    const created = repo.upsertByProviderModel({
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat',
      context_window: 64000,
      input_price: 0.1,
      output_price: 0.3,
      capabilities_json: '{"streaming":true}'
    })
    expect(created.id).toBeTruthy()
    const found = repo.findByProviderModel('p1', 'deepseek-chat')
    expect(found?.display_name).toBe('DeepSeek Chat')
  })

  it('update enables/disables a model and preserves discovered_at', () => {
    const created = repo.upsertByProviderModel({
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat'
    })
    // Disable
    const updated = repo.update(created.id, { enabled: false })
    expect(updated?.enabled).toBe(false)
    expect(updated?.discovered_at).toBe(created.discovered_at)

    // Re-enable
    const reenabled = repo.update(created.id, { enabled: true })
    expect(reenabled?.enabled).toBe(true)
  })

  it('update returns undefined for a missing id', () => {
    expect(repo.update('nope', { enabled: false })).toBeUndefined()
  })

  it('delete removes a model', () => {
    const created = repo.upsertByProviderModel({
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat'
    })
    expect(repo.delete(created.id)).toBe(true)
    expect(repo.findByProviderModel('p1', 'deepseek-chat')).toBeUndefined()
  })
})
