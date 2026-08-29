import { useEffect, useState } from 'react'
import type { DashboardTotals, RequestUsageRow } from '@shared/ipc'

export function DashboardView() {
  const [totals, setTotals] = useState<DashboardTotals | null>(null)
  const [recent, setRecent] = useState<RequestUsageRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.meowGateway.usageDashboardTotals(), window.meowGateway.usageListRecent(50)])
      .then(([t, r]) => { setTotals(t); setRecent(r) })
      .catch((e) => setError(String(e)))
  }, [])

  if (!totals) return <section><h2>Dashboard</h2><p>Loading…</p></section>

  return (
    <section>
      <h2>Dashboard</h2>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.totalRequests}</strong><div>Requests</div></div>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.totalTokens}</strong><div>Tokens</div></div>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.totalCost ?? 0}</strong><div>Est. Cost</div></div>
        <div style={{ border: '1px solid #2a3040', padding: 12, borderRadius: 8 }}><strong>{totals.successRequests}/{totals.errorRequests}/{totals.abortedRequests}</strong><div>Success/Error/Aborted</div></div>
      </div>
      <h3>By provider</h3>
      <ul>{totals.byProvider.map((bp) => <li key={bp.provider_id}>{bp.provider_id}: {bp.request_count} ({bp.total_cost ?? 0})</li>)}</ul>
      <h3>Recent requests</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Request ID</th><th>Virtual Model</th><th>Provider</th><th>Provider Model</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Status</th><th>Error</th><th>Created</th></tr></thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid #2a3040' }}>
              <td>{r.request_id}</td>
              <td>{r.virtual_model_id}</td>
              <td>{r.provider_id}</td>
              <td>{r.provider_model_id}</td>
              <td>{r.input_tokens + r.output_tokens + r.cached_tokens}</td>
              <td>{r.estimated_cost ?? 0}</td>
              <td>{r.latency_ms}ms</td>
              <td>{r.status}</td>
              <td>{r.error_code ?? '—'}</td>
              <td>{r.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
