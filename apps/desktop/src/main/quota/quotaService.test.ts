import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QuotaService } from './quotaService'
import type { ProviderRow } from '../database/types'

function makeProvider(id: string, type = 'antigravity'): ProviderRow {
  return {
    id,
    type: type as ProviderRow['type'],
    display_name: id,
    enabled: true,
    base_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
}

const summaryResponse = {
  models: {},
  quotaSummary: {
    groups: [{ buckets: [{ bucketId: '3p-5h', displayName: 'Claude (5h)', remainingFraction: 0.65, resetTime: '2026-09-09T12:00:00Z' }] }]
  },
  tier: 'individual'
}

type MockAdapter = { id: string; getQuota: ReturnType<typeof vi.fn> }

function makeService(rows: ProviderRow[], opts: { adapter?: MockAdapter; getCredential?: (ref: string) => Promise<string>; pollIntervalMs?: number } = {}) {
  const adapter: MockAdapter = opts.adapter ?? { id: 'antigravity', getQuota: vi.fn().mockResolvedValue(summaryResponse) }
  const providerRepo = { list: () => rows }
  const getCredential = opts.getCredential ?? vi.fn().mockResolvedValue(JSON.stringify({ accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer', expiresAt: Date.now() + 1e10 }))
  const service = new QuotaService({
    adapter: adapter as never,
    tokenManager: {} as never,
    providerRepo: providerRepo as never,
    getCredential,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    pollIntervalMs: opts.pollIntervalMs ?? 60_000
  })
  return { service, adapter, getCredential }
}

describe('QuotaService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('getAll() returns empty array when no accounts cached', () => {
    const { service } = makeService([])
    expect(service.getAll()).toEqual([])
  })

  it('refreshAll() filters providers by type antigravity, skips others', async () => {
    const rows = [makeProvider('ag1'), makeProvider('other1', 'openai')]
    const { service, adapter } = makeService(rows)
    await service.refreshAll()
    expect(adapter.getQuota).toHaveBeenCalledTimes(1)
    expect(service.getAll().map((d) => d.providerId)).toEqual(['ag1'])
  })

  it('refreshAll() fetches quota for each antigravity provider and caches results', async () => {
    const rows = [makeProvider('ag1'), makeProvider('ag2')]
    const { service, adapter } = makeService(rows)
    await service.refreshAll()
    expect(adapter.getQuota).toHaveBeenCalledTimes(2)
    const all = service.getAll()
    expect(all).toHaveLength(2)
    expect(all.map((d) => d.providerId).sort()).toEqual(['ag1', 'ag2'])
  })

  it('refreshAll() isolates errors: if one account fails, others still succeed', async () => {
    const rows = [makeProvider('ag1'), makeProvider('ag2')]
    const adapter = {
      id: 'antigravity',
      getQuota: vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(summaryResponse)
    }
    const { service } = makeService(rows, { adapter })
    await service.refreshAll()
    const all = service.getAll()
    expect(all).toHaveLength(2)
    const failed = all.find((d) => d.providerId === 'ag1')!
    const ok = all.find((d) => d.providerId === 'ag2')!
    expect(failed.error).toBe('boom')
    expect(failed.items).toEqual([])
    expect(ok.error).toBeUndefined()
    expect(ok.items).toHaveLength(1)
  })

  it('refreshProvider() caches successful result with items, tier, lastUpdatedAt', async () => {
    const { service } = makeService([makeProvider('ag1')])
    const data = await service.refreshProvider('ag1')
    expect(data.providerId).toBe('ag1')
    expect(data.items).toHaveLength(1)
    expect(data.items[0]).toMatchObject({ key: 'claude:5h', percentage: 65 })
    expect(data.tier).toBe('individual')
    expect(data.lastUpdatedAt).toBeGreaterThan(0)
    expect(data.error).toBeUndefined()
  })

  it('refreshProvider() on error sets error field and preserves old items if cached', async () => {
    const adapter = {
      id: 'antigravity',
      getQuota: vi.fn()
        .mockResolvedValueOnce(summaryResponse)
        .mockRejectedValueOnce(new Error('down'))
    }
    const { service } = makeService([makeProvider('ag1')], { adapter })
    await service.refreshProvider('ag1')
    const afterError = await service.refreshProvider('ag1')
    expect(afterError.error).toBe('down')
    expect(afterError.items).toHaveLength(1)
    expect(afterError.items[0].key).toBe('claude:5h')
  })

  it('refreshProvider() on error with no prior cache returns items: []', async () => {
    const adapter = { id: 'antigravity', getQuota: vi.fn().mockRejectedValue(new Error('down')) }
    const { service } = makeService([makeProvider('ag1')], { adapter })
    const data = await service.refreshProvider('ag1')
    expect(data.error).toBe('down')
    expect(data.items).toEqual([])
  })

  it('start() calls refreshAll() immediately and sets an interval', async () => {
    const rows = [makeProvider('ag1')]
    const { service, adapter } = makeService(rows)
    service.start()
    // Immediate refresh
    await vi.runAllTicks()
    expect(adapter.getQuota).toHaveBeenCalledTimes(1)
    // Advance past the poll interval
    await vi.advanceTimersByTimeAsync(60_000)
    expect(adapter.getQuota).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('stop() clears the interval', async () => {
    const rows = [makeProvider('ag1')]
    const { service, adapter } = makeService(rows)
    service.start()
    await vi.runAllTicks()
    service.stop()
    const callsAfterStart = adapter.getQuota.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(adapter.getQuota.mock.calls.length).toBe(callsAfterStart)
  })

  it('start() called twice does not create duplicate intervals', async () => {
    const rows = [makeProvider('ag1')]
    const { service, adapter } = makeService(rows)
    service.start()
    service.start()
    await vi.runAllTicks()
    // Second start() is a no-op (timer already set), so only one immediate refresh.
    const immediateCalls = adapter.getQuota.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    const afterOneInterval = adapter.getQuota.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    const afterTwoIntervals = adapter.getQuota.mock.calls.length
    expect(afterOneInterval - immediateCalls).toBe(1)
    expect(afterTwoIntervals - afterOneInterval).toBe(1)
    service.stop()
  })
})
