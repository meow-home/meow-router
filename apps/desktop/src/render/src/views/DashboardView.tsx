import { useCallback, useEffect, useState } from 'react'
import type { DashboardTotals, UsagePage } from '@shared/ipc'
import { ViewHeader, ErrorBanner, Panel, Pill, Spinner, Button } from '../components/ui'

const PAGE_SIZE = 10

function fmtCost(v: number | null | undefined): string {
  if (v == null) return '—'
  return `$${v.toFixed(4)}`
}

function statusTone(status: string): 'ok' | 'live' | 'fault' | 'warn' | 'muted' {
  switch (status) {
    case 'success': return 'ok'
    case 'error': return 'fault'
    case 'aborted': return 'warn'
    default: return 'muted'
  }
}

export function DashboardView() {
  const [totals, setTotals] = useState<DashboardTotals | null>(null)
  const [page, setPage] = useState<UsagePage | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const [refreshing, setRefreshing] = useState(false)

  const loadTotals = useCallback(async () => {
    try {
      const t = await window.meowGateway.usageDashboardTotals()
      setTotals(t)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const loadPage = useCallback(async (p: number) => {
    try {
      const result = await window.meowGateway.usageListPage(p, PAGE_SIZE)
      setPage(result)
      setCurrentPage(p)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadTotals(), loadPage(currentPage)])
    } catch (e) {
      setError(String(e))
    } finally {
      setRefreshing(false)
    }
  }, [loadTotals, loadPage, currentPage])

  useEffect(() => {
    loadTotals()
    loadPage(1)
  }, [loadTotals, loadPage])

  if (!totals || !page) return <div className="view"><h2 className="view-title">Usage</h2><Spinner label="Loading…" /></div>

  const totalPages = Math.max(1, Math.ceil(page.total / PAGE_SIZE))

  return (
    <div className="view">
      <ViewHeader title="Usage" subtitle="Tokens, cost and request health across your providers.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Button variant="ghost" onClick={() => refresh()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Reload'}
          </Button>
        </div>
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat__label">Requests</span>
          <span className="stat__value">{totals.totalRequests}</span>
          <span className="stat__meta">all time</span>
        </div>
        <div className="stat">
          <span className="stat__label">Tokens</span>
          <span className="stat__value">{totals.totalTokens}</span>
          <span className="stat__meta">in + out + cached</span>
        </div>
        <div className="stat">
          <span className="stat__label">Est. Cost</span>
          <span className="stat__value stat__value--live">{fmtCost(totals.totalCost)}</span>
          <span className="stat__meta">computed from pricing</span>
        </div>
        <div className="stat">
          <span className="stat__label">Success / Error / Aborted</span>
          <span className="stat__value stat__value--signal">{totals.successRequests}<span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-4)' }}> / </span>{totals.errorRequests}<span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-4)' }}> / </span>{totals.abortedRequests}</span>
          <span className="stat__meta">health split</span>
        </div>
      </div>

      {totals.byProvider.length > 0 && (
        <Panel title="By provider">
          <table className="table">
            <thead><tr><th>Provider</th><th>Requests</th><th>Est. Cost</th></tr></thead>
            <tbody>
              {totals.byProvider.map((bp) => (
                <tr key={bp.provider_id}>
                  <td style={{ fontFamily: 'var(--font-display)' }}>{bp.provider_name ?? bp.provider_id}</td>
                  <td className="mono">{bp.request_count}</td>
                  <td className="mono">{fmtCost(bp.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel
        title="Recent requests"
        actions={
          page.total > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-0)' }}>{page.total} total</span>
              <Button variant="ghost" disabled={currentPage <= 1} onClick={() => loadPage(currentPage - 1)}>‹ Prev</Button>
              <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-0)' }}>{currentPage} / {totalPages}</span>
              <Button variant="ghost" disabled={currentPage >= totalPages} onClick={() => loadPage(currentPage + 1)}>Next ›</Button>
            </div>
          ) : undefined
        }
      >
        {page.rows.length === 0 ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-dim)', fontSize: 'var(--fs-1)' }}>
            No traffic yet. Start the gateway and send a request to see it here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Virtual Model</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Latency</th>
                  <th>Status</th>
                  <th>Error</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{r.request_id}</td>
                    <td style={{ fontFamily: 'var(--font-display)' }}>{r.virtual_model_id}</td>
                    <td>{r.provider_name ?? r.provider_id}</td>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{r.provider_model_id}</td>
                    <td className="mono">{r.input_tokens + r.output_tokens + r.cached_tokens}</td>
                    <td className="mono">{fmtCost(r.estimated_cost)}</td>
                    <td className="mono">{r.latency_ms}ms</td>
                    <td><Pill tone={statusTone(r.status)}>{r.status}</Pill></td>
                    <td className="mono" style={{ color: 'var(--text-dim)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.error_message ?? ''}>
                      {r.error_message ?? ''}
                    </td>
                    <td className="mono" style={{ color: 'var(--text-faint)' }}>{new Date(r.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
