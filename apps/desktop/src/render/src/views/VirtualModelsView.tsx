import { useEffect, useState } from 'react'
import type { ProviderWithCredential, VirtualModelRow } from '@shared/ipc'
import { ViewHeader, Button, Field, ErrorBanner, EmptyState, Pill, Panel, Select, Input, classNames } from '../components/ui'

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

  async function handleToggle(vm: VirtualModelRow) {
    await window.meowGateway.updateVirtualModel(vm.id, { enabled: !vm.enabled })
    await refresh()
  }

  const providerName = (id: string) => providers.find((p) => p.id === id)?.display_name ?? id

  return (
    <div className="view">
      <ViewHeader title="Virtual Models" subtitle="Public IDs your coding agent calls — mapped to a concrete provider model.">
        <Button variant="primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Close' : '+ New Virtual Model'}
        </Button>
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      {showForm && (
        <Panel title="Map a new virtual model">
          <form onSubmit={handleAdd}>
            <div className="form-grid">
              <Field label="Public model name">
                <Input name="display_name" required aria-label="display name" placeholder="meow-coding" />
              </Field>
              <Field label="Provider">
                <Select name="provider_id" required options={providers.map((p) => ({ value: p.id, label: p.display_name }))} />
              </Field>
              <Field label="Provider model id">
                <Input name="provider_model_id" required aria-label="provider model id" placeholder="deepseek-chat" />
              </Field>
            </div>
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 8 }}>
              <Button type="submit" variant="primary">Save</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {vms.length === 0 && !showForm && (
        <EmptyState icon="↦" title="No virtual models" hint="Map a stable public name to a provider model." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vms.map((vm) => (
          <div key={vm.id} className={classNames('panel', vm.enabled ? '' : 'panel--off')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-3)', letterSpacing: '0.02em' }}>
                    {vm.display_name}
                  </strong>
                  <Pill tone={vm.enabled ? 'ok' : 'muted'}>{vm.enabled ? 'active' : 'disabled'}</Pill>
                </div>
                <div className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)', marginTop: 4 }}>
                  {providerName(vm.provider_id)} <span style={{ color: 'var(--text-faint)' }}>→</span> {vm.provider_model_id}
                  <span style={{ color: 'var(--text-faint)' }}> · id </span>{vm.id}
                </div>
              </div>
              <div className="view-actions">
                <Button onClick={() => handleToggle(vm)}>{vm.enabled ? 'Disable' : 'Enable'}</Button>
                <Button variant="danger" onClick={() => handleDelete(vm)}>Delete</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
