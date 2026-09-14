import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Activity, Zap, DollarSign, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from 'lucide-react'
import type { DashboardTotals, UsagePage, RequestUsageRowWithProviderName } from '@shared/ipc'
import { ViewHeader, ErrorBanner, Panel, Pill, Spinner, Button, Modal, classNames } from '../components/ui'

const PAGE_SIZE = 10

function fmtCost(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(4)}`
}

function getProviderStyle(id: string, name?: string | null) {
  const s = (name || id).toLowerCase()
  if (s.includes('deepseek')) return { type: 'deepseek', color: '#3b82f6', avatarClass: 'provider-avatar--deepseek', initials: 'DS' }
  if (s.includes('openai')) return { type: 'openai', color: '#10b981', avatarClass: 'provider-avatar--openai', initials: 'OA' }
  if (s.includes('anthropic') || s.includes('claude')) return { type: 'anthropic', color: '#f59e0b', avatarClass: 'provider-avatar--anthropic', initials: 'AN' }
  if (s.includes('codex')) return { type: 'codex', color: '#8b5cf6', avatarClass: 'provider-avatar--codex', initials: 'CX' }
  if (s.includes('groq')) return { type: 'groq', color: '#f97316', avatarClass: 'provider-avatar--groq', initials: 'GQ' }
  if (s.includes('ollama')) return { type: 'ollama', color: '#6b7280', avatarClass: 'provider-avatar--ollama', initials: 'OL' }
  if (s.includes('antigravity') || s.includes('gemini')) return { type: 'antigravity', color: '#6366f1', avatarClass: 'provider-avatar--antigravity', initials: 'AG' }

  const label = name || id
  const initials = label.slice(0, 2).toUpperCase()
  return { type: 'default', color: 'var(--accent)', avatarClass: 'provider-avatar--default', initials }
}

function statusTone(status: string): 'ok' | 'live' | 'fault' | 'warn' | 'muted' {
  switch (status) {
    case 'success': return 'ok'
    case 'error': return 'fault'
    case 'aborted': return 'warn'
    default: return 'muted'
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 size={13} style={{ color: 'var(--green)' }} />
    case 'error':
      return <XCircle size={13} style={{ color: 'var(--red)' }} />
    case 'aborted':
      return <AlertTriangle size={13} style={{ color: 'var(--yellow)' }} />
    default:
      return null
  }
}

function latencyClass(ms: number) {
  if (ms < 500) return 'fast'
  if (ms < 2000) return 'moderate'
  return 'slow'
}

export function DashboardView() {
  const [totals, setTotals] = useState<DashboardTotals | null>(null)
  const [page, setPage] = useState<UsagePage | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error' | 'aborted'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedRequest, setSelectedRequest] = useState<RequestUsageRowWithProviderName | null>(null)

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

  const successCount = page.rows.filter((r) => r.status === 'success').length
  const errorCount = page.rows.filter((r) => r.status === 'error').length
  const abortedCount = page.rows.filter((r) => r.status === 'aborted').length

  const filteredRows = page.rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchId = r.request_id.toLowerCase().includes(q)
      const matchVm = r.virtual_model_id.toLowerCase().includes(q)
      const matchProv = (r.provider_name ?? r.provider_id).toLowerCase().includes(q)
      const matchModel = r.provider_model_id.toLowerCase().includes(q)
      const matchErr = (r.error_message ?? '').toLowerCase().includes(q)
      if (!matchId && !matchVm && !matchProv && !matchModel && !matchErr) return false
    }
    return true
  })

  return (
    <div className="view">
      <ViewHeader title="Usage" subtitle="Tokens, cost and request health across your providers.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Button variant="ghost" onClick={() => refresh()} disabled={refreshing} size="sm">
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} style={{ marginRight: '6px' }} />
            {refreshing ? 'Refreshing…' : 'Reload'}
          </Button>
        </div>
      </ViewHeader>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="stat-grid">
        <div className="stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat__label">Requests</span>
            <Activity size={15} style={{ color: 'var(--accent)' }} />
          </div>
          <span className="stat__value">{totals.totalRequests}</span>
          <span className="stat__meta">all time</span>
        </div>

        <div className="stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat__label">Tokens</span>
            <Zap size={15} style={{ color: 'var(--yellow)' }} />
          </div>
          <span className="stat__value">{totals.totalTokens}</span>
          <span className="stat__meta">in + out + cached</span>
        </div>

        <div className="stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat__label">Est. Cost</span>
            <DollarSign size={15} style={{ color: 'var(--green)' }} />
          </div>
          <span className="stat__value stat__value--live">{fmtCost(totals.totalCost)}</span>
          <span className="stat__meta">computed from pricing</span>
        </div>

        <div className="stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat__label">Request Health</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <CheckCircle2 size={13} style={{ color: 'var(--green)' }} />
              <XCircle size={13} style={{ color: 'var(--red)' }} />
              <AlertTriangle size={13} style={{ color: 'var(--yellow)' }} />
            </div>
          </div>
          <span className="stat__value stat__value--signal" style={{ fontSize: '1.25rem' }}>
            <span style={{ color: 'var(--green)' }}>{totals.successRequests}</span>
            <span style={{ color: 'var(--text-faint)', margin: '0 4px' }}>/</span>
            <span style={{ color: 'var(--red)' }}>{totals.errorRequests}</span>
            <span style={{ color: 'var(--text-faint)', margin: '0 4px' }}>/</span>
            <span style={{ color: 'var(--yellow)' }}>{totals.abortedRequests}</span>
          </span>
          <span className="stat__meta">success / error / aborted</span>
        </div>
      </div>

      {totals.byProvider.length > 0 && (
        <Panel title="By provider" style={{ marginTop: 'var(--space-3)' }}>
          <div className="by-provider-container">
            {totals.totalRequests > 0 && (
              <div className="by-provider-distribution" title="Traffic distribution across providers">
                {totals.byProvider.map((bp) => {
                  const styleInfo = getProviderStyle(bp.provider_id, bp.provider_name)
                  const pct = Math.max(0.5, (bp.request_count / totals.totalRequests) * 100)
                  return (
                    <div
                      key={bp.provider_id}
                      className="by-provider-segment"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: styleInfo.color,
                      }}
                      title={`${bp.provider_name ?? bp.provider_id}: ${bp.request_count} requests (${((bp.request_count / totals.totalRequests) * 100).toFixed(1)}%)`}
                    />
                  )
                })}
              </div>
            )}

            <div className="by-provider-grid">
              {totals.byProvider.map((bp) => {
                const styleInfo = getProviderStyle(bp.provider_id, bp.provider_name)
                const sharePct = totals.totalRequests > 0
                  ? Math.round((bp.request_count / totals.totalRequests) * 100)
                  : 0

                return (
                  <div key={bp.provider_id} className="by-provider-card">
                    <div className="by-provider-card-top">
                      <div className="by-provider-identity">
                        <div className={`by-provider-avatar-sm ${styleInfo.avatarClass}`}>
                          {styleInfo.initials}
                        </div>
                        <div className="by-provider-info">
                          <span className="by-provider-name" title={bp.provider_name ?? bp.provider_id}>
                            {bp.provider_name ?? bp.provider_id}
                          </span>
                          <span className="by-provider-id">{bp.provider_id}</span>
                        </div>
                      </div>
                      <span className="by-provider-badge">{sharePct}% share</span>
                    </div>

                    <div className="by-provider-progress-track">
                      <div
                        className="by-provider-progress-fill"
                        style={{
                          width: `${sharePct}%`,
                          backgroundColor: styleInfo.color,
                        }}
                      />
                    </div>

                    <div className="by-provider-stats">
                      <div className="by-provider-stat-item">
                        <span className="by-provider-stat-label">Requests</span>
                        <span className="by-provider-stat-value">{bp.request_count}</span>
                      </div>
                      <div className="by-provider-stat-item" style={{ alignItems: 'flex-end' }}>
                        <span className="by-provider-stat-label">Est. Cost</span>
                        <span className="by-provider-cost-badge">{fmtCost(bp.total_cost)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Panel>
      )}

      <Panel
        title="Recent requests"
        style={{ marginTop: 'var(--space-3)' }}
        actions={
          page.total > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-0)' }}>{page.total} total</span>
              <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => loadPage(currentPage - 1)}>
                <ChevronLeft size={13} style={{ marginRight: '2px' }} /> Prev
              </Button>
              <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-0)' }}>{currentPage} / {totalPages}</span>
              <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => loadPage(currentPage + 1)}>
                Next <ChevronRight size={13} style={{ marginLeft: '2px' }} />
              </Button>
            </div>
          ) : undefined
        }
      >
        {page.rows.length === 0 ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-dim)', fontSize: 'var(--fs-1)' }}>
            No traffic yet. Start the gateway and send a request to see it here.
          </div>
        ) : (
          <div>
            <div className="requests-toolbar">
              <div className="requests-status-filters">
                <button
                  className={classNames('requests-filter-chip', statusFilter === 'all' && 'is-active')}
                  onClick={() => setStatusFilter('all')}
                >
                  All ({page.rows.length})
                </button>
                <button
                  className={classNames('requests-filter-chip', statusFilter === 'success' && 'is-active')}
                  onClick={() => setStatusFilter('success')}
                >
                  <span className="dot" style={{ background: 'var(--green)' }} />
                  Success ({successCount})
                </button>
                <button
                  className={classNames('requests-filter-chip', statusFilter === 'error' && 'is-active')}
                  onClick={() => setStatusFilter('error')}
                >
                  <span className="dot" style={{ background: 'var(--red)' }} />
                  Errors ({errorCount})
                </button>
                <button
                  className={classNames('requests-filter-chip', statusFilter === 'aborted' && 'is-active')}
                  onClick={() => setStatusFilter('aborted')}
                >
                  <span className="dot" style={{ background: 'var(--yellow)' }} />
                  Aborted ({abortedCount})
                </button>
              </div>

              <input
                type="text"
                className="requests-search-input"
                placeholder="Search requests…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {filteredRows.length === 0 ? (
              <div style={{ padding: 'var(--space-4)', color: 'var(--text-dim)', textAlign: 'center', fontSize: 'var(--fs-1)' }}>
                No requests match the selected filters.
              </div>
            ) : (
              <div className="table-scroll-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Request ID</th>
                      <th>Virtual Model & Route</th>
                      <th>Tokens</th>
                      <th>Est. Cost</th>
                      <th>Latency</th>
                      <th>Error Details</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => {
                      const totalTok = r.input_tokens + r.output_tokens + r.cached_tokens
                      return (
                        <tr
                          key={r.id}
                          className="request-row-interactive"
                          onClick={() => setSelectedRequest(r)}
                          title="Click to view full request details"
                        >
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <StatusIcon status={r.status} />
                              <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                            </div>
                          </td>
                          <td className="mono" style={{ color: 'var(--text-strong)', fontWeight: 500 }}>
                            {r.request_id}
                          </td>
                          <td>
                            <div className="request-routing-cell">
                              <span className="request-vm-label">{r.virtual_model_id}</span>
                              <span className="request-provider-meta">
                                <ArrowRight size={10} style={{ color: 'var(--text-faint)' }} />
                                <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>
                                  {r.provider_name ?? r.provider_id}
                                </span>
                                <span style={{ color: 'var(--text-faint)' }}>/</span>
                                <span className="mono">{r.provider_model_id}</span>
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="request-token-badge">
                              <span className="request-token-total">{totalTok}</span>
                              <span className="request-token-split">
                                {r.input_tokens} in · {r.output_tokens} out {r.cached_tokens > 0 ? `· ${r.cached_tokens} cached` : ''}
                              </span>
                            </div>
                          </td>
                          <td className="mono">{fmtCost(r.estimated_cost)}</td>
                          <td>
                            <span className={`request-latency-badge ${latencyClass(r.latency_ms)}`}>
                              {r.latency_ms}ms
                            </span>
                          </td>
                          <td>
                            {r.error_message ? (
                              <span className="request-error-chip" title={r.error_message}>
                                <AlertTriangle size={11} style={{ flexShrink: 0 }} />
                                {r.error_code ? `${r.error_code}: ` : ''}{r.error_message}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-0)' }}>—</span>
                            )}
                          </td>
                          <td className="mono" style={{ color: 'var(--text-faint)' }}>
                            {new Date(r.created_at).toLocaleTimeString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>

      {selectedRequest && (
        <Modal
          open={!!selectedRequest}
          title={`Request Inspector — ${selectedRequest.request_id}`}
          onClose={() => setSelectedRequest(null)}
          width={600}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="request-detail-grid">
              <div className="request-detail-card">
                <span className="request-detail-label">Status & Health</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <StatusIcon status={selectedRequest.status} />
                  <Pill tone={statusTone(selectedRequest.status)}>{selectedRequest.status}</Pill>
                  <span className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)' }}>
                    ({selectedRequest.latency_ms}ms)
                  </span>
                </div>
              </div>

              <div className="request-detail-card">
                <span className="request-detail-label">Estimated Cost</span>
                <span className="request-detail-val" style={{ color: 'var(--green)', marginTop: '4px' }}>
                  {fmtCost(selectedRequest.estimated_cost)}
                </span>
              </div>

              <div className="request-detail-card">
                <span className="request-detail-label">Virtual Model</span>
                <span className="request-detail-val">{selectedRequest.virtual_model_id}</span>
              </div>

              <div className="request-detail-card">
                <span className="request-detail-label">Target Provider / Model</span>
                <span className="request-detail-val">
                  {selectedRequest.provider_name ?? selectedRequest.provider_id} / {selectedRequest.provider_model_id}
                </span>
              </div>

              <div className="request-detail-card">
                <span className="request-detail-label">Token Breakdown</span>
                <span className="request-detail-val">
                  {selectedRequest.input_tokens + selectedRequest.output_tokens + selectedRequest.cached_tokens} total
                </span>
                <span className="mono" style={{ fontSize: 'var(--fs-0)', color: 'var(--text-faint)' }}>
                  Input: {selectedRequest.input_tokens} | Output: {selectedRequest.output_tokens} | Cached: {selectedRequest.cached_tokens}
                </span>
              </div>

              <div className="request-detail-card">
                <span className="request-detail-label">Timestamp & Attempt</span>
                <span className="request-detail-val">
                  {new Date(selectedRequest.created_at).toLocaleString()}
                </span>
                <span className="mono" style={{ fontSize: 'var(--fs-0)', color: 'var(--text-faint)' }}>
                  Route Attempt: #{selectedRequest.route_attempt + 1}
                </span>
              </div>
            </div>

            {selectedRequest.error_message && (
              <div className="request-error-box">
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {selectedRequest.error_code ?? 'ERROR'}:
                </div>
                {selectedRequest.error_message}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
