import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ModelRow } from '@shared/ipc'

export function ModelsView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = async (pid: string) => {
    if (!pid) { setModels([]); return }
    const rows = await window.meowGateway.listModelsByProvider(pid)
    setModels(rows)
  }

  useEffect(() => {
    window.meowGateway.listProviders().then((p) => {
      setProviders(p)
      if (p.length > 0) { setProviderId(p[0].id); refresh(p[0].id) }
    }).catch((e) => setError(String(e)))
  }, [])

  async function handleRefresh() {
    await window.meowGateway.discoverModels(providerId)
    await refresh(providerId)
  }

  async function handleToggle(m: ModelRow) {
    await window.meowGateway.setModelEnabled(m.id, !m.enabled)
    await refresh(providerId)
  }

  async function handleDelete(m: ModelRow) {
    await window.meowGateway.deleteModel(m.id)
    await refresh(providerId)
  }

  return (
    <section>
      <h2>Models</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={providerId} onChange={(e) => { setProviderId(e.target.value); refresh(e.target.value) }}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <button onClick={handleRefresh}>Refresh models</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Name</th><th>Model ID</th><th>Context</th><th>In</th><th>Out</th><th>Capabilities</th><th>Enabled</th></tr></thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid #2a3040' }}>
              <td>{m.display_name}</td>
              <td>{m.provider_model_id}</td>
              <td>{m.context_window ?? '-'}</td>
              <td>{m.input_price ?? '-'}</td>
              <td>{m.output_price ?? '-'}</td>
              <td>{m.capabilities_json ?? '—'}</td>
              <td><button onClick={() => handleToggle(m)}>{m.enabled ? 'Disable' : 'Enable'}</button></td>
              <td><button onClick={() => handleDelete(m)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
