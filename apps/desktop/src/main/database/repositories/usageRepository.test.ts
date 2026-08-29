// Tests for UsageRepository record/list/totals and UsageService cost integration (T501).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from '../connection'
import { ProviderRepository, ModelRepository, UsageRepository } from './index'
import { UsageService } from '../../gateway/usageService'

describe('UsageRepository', () => {
  let db: PersistedConnection
  let repo: UsageRepository
  let modelRepo: ModelRepository
  let service: UsageService

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    const providerRepo = new ProviderRepository(db)
    modelRepo = new ModelRepository(db)
    repo = new UsageRepository(db)
    providerRepo.create({ id: 'openai', type: 'openai', display_name: 'OpenAI' })
    modelRepo.create({
      provider_id: 'openai',
      provider_model_id: 'gpt-4o',
      display_name: 'GPT-4o',
      input_price: 2,
      output_price: 8
    })
    service = new UsageService(repo, modelRepo)
  })

  afterEach(() => closeDatabase(db))

  const base = {
    request_id: 'req-1',
    virtual_model_id: 'meow-coding',
    provider_id: 'openai',
    provider_model_id: 'gpt-4o',
    input_tokens: 1000,
    output_tokens: 500,
    cached_tokens: 0,
    latency_ms: 120,
    status: 'success' as const,
    error_code: null
  }

  it('records a usage row and reads it back', () => {
    const row = repo.record(base)
    expect(row.id).toBeTruthy()
    expect(row.request_id).toBe('req-1')
    expect(row.estimated_cost).toBeNull()
    expect(repo.findById(row.id)?.request_id).toBe('req-1')
  })

  it('records estimated cost when pricing is known', () => {
    const row = repo.record({ ...base, estimated_cost: 0.006 })
    expect(row.estimated_cost).toBe(0.006)
  })

  it('lists most-recent first', () => {
    repo.record({ ...base, request_id: 'a', created_at: '2026-01-01T00:00:00Z' })
    repo.record({ ...base, request_id: 'b', created_at: '2026-01-02T00:00:00Z' })
    const rows = repo.list()
    expect(rows[0].request_id).toBe('b')
    expect(rows[1].request_id).toBe('a')
  })

  it('filters by provider and virtual model', () => {
    repo.record({ ...base, provider_id: 'openai' })
    repo.record({ ...base, provider_id: 'openai', request_id: 'r2', virtual_model_id: 'other' })
    expect(repo.listByProvider('openai')).toHaveLength(2)
    expect(repo.listByVirtualModel('other')).toHaveLength(1)
  })

  it('UsageService recordUsage estimates cost from model pricing', async () => {
    await service.recordUsage({
      requestId: 'req-est',
      virtualModelId: 'meow-coding',
      providerId: 'openai',
      providerModelId: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      latencyMs: 50,
      status: 'success'
    })
    const rows = repo.list()
    expect(rows[0].estimated_cost).toBeCloseTo(0.006, 8)
  })

  it('UsageService estimate returns null for unknown pricing', async () => {
    modelRepo.create({
      provider_id: 'openai',
      provider_model_id: 'unknown-price',
      display_name: 'No Price'
    })
    const est = service.estimate({
      requestId: 'r',
      virtualModelId: 'v',
      providerId: 'openai',
      providerModelId: 'unknown-price',
      inputTokens: 10,
      outputTokens: 10,
      cachedTokens: 0,
      latencyMs: 1,
      status: 'success'
    })
    expect(est).toBeNull()
  })

  it('derives dashboard totals from persisted records', () => {
    repo.record({ ...base, status: 'success', estimated_cost: 0.006, input_tokens: 1000, output_tokens: 500 })
    repo.record({ ...base, request_id: 'r2', status: 'error', estimated_cost: null, input_tokens: 10, output_tokens: 0, error_code: 'AUTH_ERROR', error_message: 'Invalid API key' })
    repo.record({ ...base, request_id: 'r3', status: 'aborted', estimated_cost: 0.001, input_tokens: 0, output_tokens: 0 })
    const t = repo.dashboardTotals()
    expect(t.totalRequests).toBe(3)
    expect(t.totalTokens).toBe(1510)
    expect(t.totalCost).toBe(0.007)
    expect(t.successRequests).toBe(1)
    expect(t.errorRequests).toBe(1)
    expect(t.abortedRequests).toBe(1)
    expect(t.byProvider[0].provider_id).toBe('openai')
    expect(t.byProvider[0].provider_name).toBe('OpenAI')
    expect(t.byProvider[0].request_count).toBe(3)
  })

  it('lists a page of rows with the provider name joined in', () => {
    repo.record({ ...base, request_id: 'a', created_at: '2026-01-01T00:00:00Z' })
    repo.record({ ...base, request_id: 'b', created_at: '2026-01-02T00:00:00Z', error_code: 'AUTH_ERROR', error_message: 'Bad key' })
    repo.record({ ...base, request_id: 'c', created_at: '2026-01-03T00:00:00Z' })
    const page = repo.listPage(2, 2)
    expect(page.total).toBe(3)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].request_id).toBe('a')
    expect(page.rows[0].provider_name).toBe('OpenAI')
    expect(repo.findById(page.rows[0].id)!.error_message).toBeNull()
  })
})
