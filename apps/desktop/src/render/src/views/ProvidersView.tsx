import { useEffect, useState } from 'react'
import { Plus, Zap, RefreshCw, Edit3, Trash2, Key, Globe, ShieldCheck, Layers, CheckCircle2 } from 'lucide-react'
import type { ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'
import { ViewHeader, Button, Pill, ErrorBanner, EmptyState, Modal, ConfirmDialog, classNames } from '../components/ui'
import { AddProviderModal } from '../components/AddProviderModal'
import { EditProviderModal } from '../components/EditProviderModal'

function getAvatarClass(type: string): string {
  switch (type.toLowerCase()) {
    case 'deepseek': return 'provider-avatar--deepseek'
    case 'openai': return 'provider-avatar--openai'
    case 'anthropic': return 'provider-avatar--anthropic'
    case 'codex': return 'provider-avatar--codex'
    case 'groq': return 'provider-avatar--groq'
    case 'ollama': return 'provider-avatar--ollama'
    default: return 'provider-avatar--default'
  }
}

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

  const activeCount = providers.filter(p => p.enabled).length
  const securedCount = providers.filter(p => p.hasCredential).length

  return (
    <div className="view">
      <ViewHeader title="Providers" subtitle="Connect AI providers and manage their credentials securely.">
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} style={{ marginRight: '6px' }} />
          Add Provider
        </Button>
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      {providers.length > 0 && (
        <div className="provider-stats-bar">
          <div className="provider-stat-card">
            <span className="provider-stat-label">Total Providers</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="provider-stat-val">{providers.length}</span>
              <Layers size={18} style={{ color: 'var(--accent)' }} />
            </div>
          </div>
          <div className="provider-stat-card">
            <span className="provider-stat-label">Active Providers</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="provider-stat-val">{activeCount}</span>
              <CheckCircle2 size={18} style={{ color: 'var(--green)' }} />
            </div>
          </div>
          <div className="provider-stat-card">
            <span className="provider-stat-label">Credentials Stored</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="provider-stat-val">{securedCount}</span>
              <ShieldCheck size={18} style={{ color: 'var(--blue)' }} />
            </div>
          </div>
        </div>
      )}

      {providers.length === 0 && (
        <EmptyState icon="⇄" title="No providers yet" hint="Add a provider to start routing model traffic." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {providers.map((p) => (
          <div key={p.id} className={classNames('provider-card', p.enabled ? '' : 'is-disabled')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div className={`provider-avatar ${getAvatarClass(p.type)}`}>
                {p.display_name.charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-3)', letterSpacing: '0.01em', color: 'var(--text-strong)' }}>
                    {p.display_name}
                  </strong>
                  <Pill tone={p.enabled ? 'ok' : 'muted'}>{p.enabled ? 'enabled' : 'disabled'}</Pill>
                  {p.hasCredential ? (
                    <Pill tone="ok"><Key size={12} style={{ marginRight: '4px' }} />key set</Pill>
                  ) : (
                    <Pill tone="warn">no key</Pill>
                  )}
                </div>

                <div className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)', marginTop: 6, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ textTransform: 'lowercase', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: 'var(--radius-sm)' }}>
                    {p.type}
                  </span>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <Globe size={12} style={{ color: 'var(--text-faint)' }} />
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {p.base_url || 'default provider endpoint'}
                  </span>
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
      <Modal open={notice != null} title="Provider Status" onClose={() => setNotice(null)}>
        <p className="dialog-message mono" style={{ fontSize: 'var(--fs-2)', padding: 'var(--space-2)' }}>{notice}</p>
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
