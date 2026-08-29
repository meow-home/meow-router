import { useEffect, useState } from 'react'
import type { ProviderWithCredential, VirtualModelRow } from '@shared/ipc'
import { ViewHeader, Button, ErrorBanner, EmptyState, Pill, ConfirmDialog, classNames } from '../components/ui'
import { VirtualModelModal } from '../components/VirtualModelModal'

export function VirtualModelsView() {
  const [vms, setVms] = useState<VirtualModelRow[]>([])
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<VirtualModelRow | null>(null)
  const [deleting, setDeleting] = useState<VirtualModelRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [v, p] = await Promise.all([window.meowGateway.listVirtualModels(), window.meowGateway.listProviders()])
    setVms(v); setProviders(p)
  }

  useEffect(() => { refresh().catch((e) => setError(String(e))) }, [])

  function handleNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function handleEdit(vm: VirtualModelRow) {
    setEditing(vm)
    setModalOpen(true)
  }

  async function handleSaved() {
    setModalOpen(false)
    setEditing(null)
    await refresh()
  }

  async function handleConfirmDelete() {
    if (!deleting) return
    try {
      await window.meowGateway.deleteVirtualModel(deleting.id)
      setDeleting(null)
      await refresh()
    } catch (e) {
      setError(String(e))
      setDeleting(null)
    }
  }

  async function handleToggle(vm: VirtualModelRow) {
    await window.meowGateway.updateVirtualModel(vm.id, { enabled: !vm.enabled })
    await refresh()
  }

  const providerName = (id: string) => providers.find((p) => p.id === id)?.display_name ?? id

  return (
    <div className="view">
      <ViewHeader title="Virtual Models" subtitle="Public IDs your coding agent calls — mapped to a concrete provider model.">
        <Button variant="primary" onClick={handleNew}>
          + New Virtual Model
        </Button>
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      <VirtualModelModal
        open={modalOpen}
        providers={providers}
        initial={editing}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete virtual model"
        message={`Delete "${deleting?.display_name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleting(null)}
      />

      {vms.length === 0 && !modalOpen && (
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
                <Button onClick={() => handleEdit(vm)}>Edit</Button>
                <Button onClick={() => handleToggle(vm)}>{vm.enabled ? 'Disable' : 'Enable'}</Button>
                <Button variant="danger" onClick={() => setDeleting(vm)}>Delete</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
