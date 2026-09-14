import { useEffect, useState } from 'react'
import { Plus, Zap, RefreshCw, Edit3, Trash2, Key, Globe } from 'lucide-react'
import type { ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'
import { ViewHeader, Button, Pill, ErrorBanner, EmptyState, Modal, ConfirmDialog, classNames } from '../components/ui'
import { AddProviderModal } from '../components/AddProviderModal'
import { EditProviderModal } from '../components/EditProviderModal'

export function ProvidersView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [types, setTypes] = useState<ProviderTypeDescriptor[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<ProviderWithCredential | null>(null)
  const [deleting, setDeleting] = useState<ProviderWithCredential | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = async () => {
    const [p, t] = await Promise.all([window.meowGateway.listProviders(), window.meowGateway.listProviderTypes()])
    setProviders(p)
    setTypes(t)
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)))
  }, [])

  async function handleToggle(p: ProviderWithCredential) {
    await window.meowGateway.updateProvider(p.id, { enabled: !p.enabled })
    await refresh()
  }

  async function handleConfirmDelete() {
    if (!deleting) return
    try {
      await window.meowGateway.deleteProvider(deleting.id)
      setDeleting(null)
      await refresh()
    } catch (e) {
      setError(String(e))
      setDeleting(null)
    }
  }

  async function handleTest(p: ProviderWithCredential) {
    const res = await window.meowGateway.testProviderConnection(p.id)
    setNotice(`${res.ok ? 'OK' : 'FAIL'}: ${res.message}`)
  }

  async function handleDiscover(p: ProviderWithCredential) {
    const models = await window.meowGateway.discoverModels(p.id)
    setNotice(`Discovered ${models.length} models`)
  }

  return (
    <div className="view">
      <ViewHeader title="Providers" subtitle="Connect AI providers and manage their credentials.">
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} style={{ marginRight: '6px' }} />
          Add Provider
        </Button>
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      {providers.length === 0 && (
        <EmptyState icon="⇄" title="No providers yet" hint="Add a provider to start routing model traffic." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.map((p) => (
          <div key={p.id} className={classNames('panel', p.enabled ? '' : 'panel--off')} style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 'var(--radius)',
                background: p.enabled ? 'var(--accent-dim)' : 'var(--bg-hover)',
                color: p.enabled ? 'var(--accent-strong)' : 'var(--text-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 'var(--fw-semibold)', fontSize: '1rem'
              }}>
                {p.display_name.charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-3)', letterSpacing: '0.02em', color: 'var(--text-strong)' }}>
                    {p.display_name}
                  </strong>
                  <Pill tone={p.enabled ? 'ok' : 'muted'}>{p.enabled ? 'enabled' : 'disabled'}</Pill>
                  {p.hasCredential ? (
                    <Pill tone="ok"><Key size={12} style={{ marginRight: '4px' }} />key set</Pill>
                  ) : (
                    <Pill tone="warn">no key</Pill>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)', marginTop: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{p.type}</span>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <Globe size={12} style={{ color: 'var(--text-faint)' }} />
                  <span>{p.base_url || 'default endpoint'}</span>
                </div>
              </div>

              <div className="view-actions" style={{ gap: '6px' }}>
                <Button onClick={() => setEditing(p)} title="Edit configuration">
                  <Edit3 size={13} style={{ marginRight: '4px' }} />
                  Edit
                </Button>
                <Button onClick={() => handleToggle(p)}>
                  {p.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button onClick={() => handleTest(p)} title="Test provider connection">
                  <Zap size={13} style={{ marginRight: '4px' }} />
                  Test
                </Button>
                <Button onClick={() => handleDiscover(p)} title="Discover available models">
                  <RefreshCw size={13} style={{ marginRight: '4px' }} />
                  Sync Models
                </Button>
                <Button variant="danger" onClick={() => setDeleting(p)} title="Delete provider">
                  <Trash2 size={13} style={{ marginRight: '4px' }} />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AddProviderModal
        open={showAdd}
        types={types}
        onClose={() => setShowAdd(false)}
        onCreated={async () => {
          await refresh()
          setShowAdd(false)
        }}
      />
      <EditProviderModal
        open={editing != null}
        provider={editing}
        types={types}
        onClose={() => setEditing(null)}
        onUpdated={async () => {
          await refresh()
          setEditing(null)
        }}
      />
      <Modal open={notice != null} title="Provider" onClose={() => setNotice(null)}>
        <p className="dialog-message mono">{notice}</p>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete provider"
        message={`Delete "${deleting?.display_name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
