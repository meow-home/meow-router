// Repository for request usage and cost records.
//
// Every completed/aborted/failed request is recorded here. Dashboard totals are
// derived from these persisted records (never computed on the fly from
// unrelated state).

import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { RequestUsageRow, NewRequestUsage } from '../types'

// All columns are non-null on disk; `estimated_cost`/`error_code` are nullable.
// We cast the raw row through this to satisfy TS's structural overlap check.
type RawUsage = Omit<RequestUsageRow, 'estimated_cost' | 'error_code'> & {
  estimated_cost: number | null
  error_code: string | null
}

function mapRow(r: RawUsage): RequestUsageRow {
  return {
    id: r.id,
    request_id: r.request_id,
    virtual_model_id: r.virtual_model_id,
    provider_id: r.provider_id,
    provider_model_id: r.provider_model_id,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cached_tokens: r.cached_tokens,
    estimated_cost: r.estimated_cost,
    latency_ms: r.latency_ms,
    status: r.status,
    error_code: r.error_code,
    route_attempt: r.route_attempt,
    created_at: r.created_at
  }
}

export interface DashboardTotals {
  totalRequests: number
  totalTokens: number
  totalCost: number | null
  successRequests: number
  errorRequests: number
  abortedRequests: number
  byProvider: Array<{ provider_id: string; request_count: number; total_cost: number | null }>
}

export class UsageRepository {
  constructor(private readonly db: PersistedConnection) {}

  record(input: NewRequestUsage): RequestUsageRow {
    const row: RequestUsageRow = {
      id: input.id || randomUUID(),
      request_id: input.request_id,
      virtual_model_id: input.virtual_model_id,
      provider_id: input.provider_id,
      provider_model_id: input.provider_model_id,
      input_tokens: input.input_tokens,
      output_tokens: input.output_tokens,
      cached_tokens: input.cached_tokens,
      estimated_cost: input.estimated_cost ?? null,
      latency_ms: input.latency_ms,
      status: input.status,
      error_code: input.error_code ?? null,
      route_attempt: input.route_attempt ?? 0,
      created_at: input.created_at ?? new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO request_usage (id, request_id, virtual_model_id, provider_id,
          provider_model_id, input_tokens, output_tokens, cached_tokens, estimated_cost,
          latency_ms, status, error_code, route_attempt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run([
        row.id, row.request_id, row.virtual_model_id, row.provider_id, row.provider_model_id,
        row.input_tokens, row.output_tokens, row.cached_tokens, row.estimated_cost, row.latency_ms,
        row.status, row.error_code, row.route_attempt, row.created_at
      ])
    this.db.save()
    return row
  }

  findById(id: string): RequestUsageRow | undefined {
    const r = this.db.prepare('SELECT * FROM request_usage WHERE id = ?').get([id]) as RawUsage | undefined
    return r ? mapRow(r) : undefined
  }

  list(limit = 100): RequestUsageRow[] {
    return (this.db
      .prepare('SELECT * FROM request_usage ORDER BY created_at DESC LIMIT ?')
      .all([limit]) as RawUsage[]).map(mapRow)
  }

  listByProvider(providerId: string): RequestUsageRow[] {
    return (this.db
      .prepare('SELECT * FROM request_usage WHERE provider_id = ? ORDER BY created_at DESC')
      .all([providerId]) as RawUsage[]).map(mapRow)
  }

  listByVirtualModel(virtualModelId: string): RequestUsageRow[] {
    return (this.db
      .prepare('SELECT * FROM request_usage WHERE virtual_model_id = ? ORDER BY created_at DESC')
      .all([virtualModelId]) as RawUsage[]).map(mapRow)
  }

  dashboardTotals(): DashboardTotals {
    const all = this.list(10000)
    const success = all.filter((r) => r.status === 'success')
    const error = all.filter((r) => r.status === 'error')
    const aborted = all.filter((r) => r.status === 'aborted')
    const totalTokens = all.reduce((s, r) => s + r.input_tokens + r.output_tokens + r.cached_tokens, 0)
    const costs = all.map((r) => r.estimated_cost).filter((c): c is number => c !== null)
    const totalCost = costs.length > 0 ? round(costs.reduce((a, b) => a + b, 0)) : null
    return {
      totalRequests: all.length,
      totalTokens,
      totalCost,
      successRequests: success.length,
      errorRequests: error.length,
      abortedRequests: aborted.length,
      byProvider: aggregateByProvider(all)
    }
  }
}

function aggregateByProvider(rows: RequestUsageRow[]): DashboardTotals['byProvider'] {
  const map = new Map<string, { count: number; costs: number[] }>()
  for (const r of rows) {
    const entry = map.get(r.provider_id) ?? { count: 0, costs: [] }
    entry.count += 1
    if (r.estimated_cost !== null) entry.costs.push(r.estimated_cost)
    map.set(r.provider_id, entry)
  }
  return [...map.entries()]
    .map(([provider_id, v]) => ({
      provider_id,
      request_count: v.count,
      total_cost: v.costs.length > 0 ? round(v.costs.reduce((a, b) => a + b, 0)) : null
    }))
    .sort((a, b) => b.request_count - a.request_count)
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8
}
