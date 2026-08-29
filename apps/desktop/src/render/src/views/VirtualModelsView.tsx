import { useEffect, useState } from 'react'
import type { ProviderWithCredential, VirtualModelRow } from '@shared/ipc'

export function VirtualModelsView() {
  const [vms, setVms] = useState<VirtualModelRow[]>([])
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [v, p] = await Promise.all([window.meowGateway.listVirtualModels(), window.meowGateway.listProviders()])
    setVms(v); setProviders(p)
  }

  useEffect(() => { refresh().catch((e) => setError(String(e))) }, [])

  async function handleAdd(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget)
    try {
      await window.meowGateway.createVirtualModel({
        display_name: String(fd.get('display_name')),
        provider_id: String(fd.get('provider_id')),
        provider_model_id: String(fd.get('provider_model_id')),
        routing_policy_id: null
      })
      setShowForm(false)
      await refresh()
    } catch (e) { setError(String(e)) }
  }

  async function handleDelete(vm: VirtualModelRow) {
    await window.meowGateway.deleteVirtualModel(vm.id)
    await refresh()
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Virtual Models</h2>
        <button onClick={() => setShowForm(!showForm)}>New Virtual Model</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      {showForm && (
        <form onSubmit={handleAdd} style={{ border: '1px solid #2a3040', padding: 16, marginBottom: 16, borderRadius: 8 }}>
          <label>Display name <input name="display_name" required aria-label="display name" /></label>
          <label>Provider <select name="provider_id" required>{providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
          <label>Provider model id <input name="provider_model_id" required aria-label="provider model id" /></label>
          <button type="submit">Save</button>
        </form>
      )}
      {vms.map((vm) => (
        <div key={vm.id} style={{ border: '1px solid #2a3040', padding: 12, marginBottom: 8, borderRadius: 8 }}>
          <strong>{vm.display_name}</strong> → {vm.provider_id}/{vm.provider_model_id}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => handleDelete(vm)}>Delete</button>
            <button onClick={() => window.meowGateway.updateVirtualModel(vm.id, { enabled: !vm.enabled }).then(refresh)}>{vm.enabled ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      ))}
    </section>
  )
}
