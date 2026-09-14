import { useEffect, useState } from 'react'
import { Plus, Edit3, Trash2, Route, ArrowRight } from 'lucide-react'
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
          <Plus size={14} style={{ marginRight: '6px' }} />
          New Virtual Model
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {vms.map((vm) => (
          <div key={vm.id} className={classNames('panel', vm.enabled ? '' : 'panel--off')} style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 'var(--radius)',
                background: vm.enabled ? 'var(--accent-dim)' : 'var(--bg-hover)',
                color: vm.enabled ? 'var(--accent-strong)' : 'var(--text-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Route size={20} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-3)', letterSpacing: '0.02em', color: 'var(--text-strong)' }}>
                    {vm.display_name}
                  </strong>
                  <Pill tone={vm.enabled ? 'ok' : 'muted'}>{vm.enabled ? 'active' : 'disabled'}</Pill>
                </div>
                <div className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)', marginTop: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{providerName(vm.provider_id)}</span>
                  <ArrowRight size={12} style={{ color: 'var(--accent)' }} />
                  <span style={{ color: 'var(--text-strong)' }}>{vm.provider_model_id}</span>
                  <span style={{ color: 'var(--text-faint)' }}> · id </span>
                  <span style={{ color: 'var(--text-faint)' }}>{vm.id}</span>
                </div>
              </div>

              <div className="view-actions" style={{ gap: '6px' }}>
                <Button onClick={() => handleEdit(vm)}>
                  <Edit3 size={13} style={{ marginRight: '4px' }} />
                  Edit
                </Button>
                <Button onClick={() => handleToggle(vm)}>{vm.enabled ? 'Disable' : 'Enable'}</Button>
                <Button variant="danger" onClick={() => setDeleting(vm)}>
                  <Trash2 size={13} style={{ marginRight: '4px' }} />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
