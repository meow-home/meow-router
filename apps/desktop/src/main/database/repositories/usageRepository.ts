// Repository for request usage and cost records.
//
// Every completed/aborted/failed request is recorded here. Dashboard totals are
// derived from these persisted records (never computed on the fly from
// unrelated state).

import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { RequestUsageRow, RequestUsageRowWithProviderName, NewRequestUsage } from '../types'

// All columns are non-null on disk; `estimated_cost`/`error_code`/`error_message`
// are nullable. We cast the raw row through this to satisfy TS's structural
// overlap check.
type RawUsage = Omit<RequestUsageRow, 'estimated_cost' | 'error_code' | 'error_message'> & {
  estimated_cost: number | null
  error_code: string | null
  error_message: string | null
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
    error_message: r.error_message,
    route_attempt: r.route_attempt,
    created_at: r.created_at
  }
}

// Raw row with the provider display name joined in for the renderer.
type RawUsageWithProvider = RawUsage & { provider_name: string | null }

function mapRowWithProvider(r: RawUsageWithProvider): RequestUsageRowWithProviderName {
  return {
    ...mapRow(r),
    provider_name: r.provider_name
  }
}

export interface DashboardTotals {
  totalRequests: number
  totalTokens: number
  totalCost: number | null
  successRequests: number
  errorRequests: number
  abortedRequests: number
  byProvider: Array<{ provider_id: string; provider_name: string | null; request_count: number; total_cost: number | null }>
}

// A single page of request usage plus the total row count, so the renderer can
// compute page boundaries without querying the DB for every page.
export interface UsagePage {
  rows: RequestUsageRowWithProviderName[]
  total: number
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
      error_message: input.error_message ?? null,
      route_attempt: input.route_attempt ?? 0,
      created_at: input.created_at ?? new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO request_usage (id, request_id, virtual_model_id, provider_id,
          provider_model_id, input_tokens, output_tokens, cached_tokens, estimated_cost,
          latency_ms, status, error_code, error_message, route_attempt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run([
        row.id, row.request_id, row.virtual_model_id, row.provider_id, row.provider_model_id,
        row.input_tokens, row.output_tokens, row.cached_tokens, row.estimated_cost, row.latency_ms,
        row.status, row.error_code, row.error_message, row.route_attempt, row.created_at
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

  // A single page of the most-recent requests with the provider name joined in,
  // plus the total count for pagination.
  listPage(page: number, pageSize: number): UsagePage {
    const offset = (page - 1) * pageSize
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM request_usage').get() as { n: number }).n
    const rows = (this.db
      .prepare(
        `SELECT u.*, p.display_name AS provider_name
         FROM request_usage u
         LEFT JOIN provider p ON p.id = u.provider_id
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all([pageSize, offset]) as RawUsageWithProvider[]).map(mapRowWithProvider)
    return { rows, total }
  }

  dashboardTotals(): DashboardTotals {
    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_requests,
           COALESCE(SUM(input_tokens + output_tokens + cached_tokens), 0) AS total_tokens,
           SUM(estimated_cost) AS total_cost,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_requests,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_requests,
           SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_requests
         FROM request_usage`
      )
      .get() as {
        total_requests: number
        total_tokens: number
        total_cost: number | null
        success_requests: number
        error_requests: number
        aborted_requests: number
      }
    return {
      totalRequests: totals.total_requests,
      totalTokens: totals.total_tokens,
      totalCost: totals.total_cost !== null ? round(totals.total_cost) : null,
      successRequests: totals.success_requests,
      errorRequests: totals.error_requests,
      abortedRequests: totals.aborted_requests,
      byProvider: aggregateByProvider(this.db)
    }
  }
}

function aggregateByProvider(db: PersistedConnection): DashboardTotals['byProvider'] {
  const rows = db
    .prepare(
      `SELECT u.provider_id, p.display_name AS provider_name,
              COUNT(*) AS request_count,
              SUM(u.estimated_cost) AS total_cost
       FROM request_usage u
       LEFT JOIN provider p ON p.id = u.provider_id
       GROUP BY u.provider_id, p.display_name
       ORDER BY request_count DESC`
    )
    .all() as Array<{ provider_id: string; provider_name: string | null; request_count: number; total_cost: number | null }>
  return rows.map((r) => ({
    provider_id: r.provider_id,
    provider_name: r.provider_name,
    request_count: r.request_count,
    total_cost: r.total_cost !== null ? round(r.total_cost) : null
  }))
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8
}
