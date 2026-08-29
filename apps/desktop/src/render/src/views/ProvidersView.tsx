import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'

export function ProvidersView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [types, setTypes] = useState<ProviderTypeDescriptor[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [p, t] = await Promise.all([window.meowGateway.listProviders(), window.meowGateway.listProviderTypes()])
    setProviders(p)
    setTypes(t)
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)))
  }, [])

  async function handleAdd(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget)
    const type = String(fd.get('type'))
    const displayName = String(fd.get('display_name'))
    const baseUrl = String(fd.get('base_url'))
    const key = String(fd.get('key'))
    try {
      const created = await window.meowGateway.createProvider({ type, display_name: displayName, base_url: baseUrl || undefined })
      if (key) await window.meowGateway.setProviderCredential(created.id, key)
      setShowForm(false)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  async function handleToggle(p: ProviderWithCredential) {
    await window.meowGateway.updateProvider(p.id, { enabled: !p.enabled })
    await refresh()
  }

  async function handleDelete(p: ProviderWithCredential) {
    await window.meowGateway.deleteProvider(p.id)
    await refresh()
  }

  async function handleTest(p: ProviderWithCredential) {
    const res = await window.meowGateway.testProviderConnection(p.id)
    alert(`${res.ok ? 'OK' : 'FAIL'}: ${res.message}`)
  }

  async function handleDiscover(p: ProviderWithCredential) {
    const models = await window.meowGateway.discoverModels(p.id)
    alert(`Discovered ${models.length} models`)
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Providers</h2>
        <button onClick={() => setShowForm(!showForm)}>Add Provider</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      {showForm && (
        <form onSubmit={handleAdd} style={{ border: '1px solid #2a3040', padding: 16, marginBottom: 16, borderRadius: 8 }}>
          <label>
            Type <select name="type" required>
              {types.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
              {types.length === 0 && <option value="deepseek">DeepSeek</option>}
            </select>
          </label>
          <label>
            Display name <input name="display_name" required aria-label="display name" />
          </label>
          <label>
            Base URL <input name="base_url" placeholder="https://api.deepseek.com/v1" />
          </label>
          <label>
            API key <input name="key" type="password" aria-label="api key" />
          </label>
          <button type="submit">Save Provider</button>
        </form>
      )}
      {providers.map((p) => (
        <div key={p.id} style={{ border: '1px solid #2a3040', padding: 12, marginBottom: 8, borderRadius: 8 }}>
          <strong>{p.display_name}</strong> <span style={{ opacity: 0.6 }}>[{p.type}]</span>
          {p.hasCredential ? <em style={{ color: '#4caf50' }}>  ✓ key set</em> : <em style={{ color: '#ff9800' }}>  no key</em>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => handleToggle(p)}>{p.enabled ? 'Disable' : 'Enable'}</button>
            <button onClick={() => handleTest(p)}>Test</button>
            <button onClick={() => handleDiscover(p)}>Discover models</button>
            <button onClick={() => handleDelete(p)}>Delete</button>
          </div>
        </div>
      ))}
    </section>
  )
}
