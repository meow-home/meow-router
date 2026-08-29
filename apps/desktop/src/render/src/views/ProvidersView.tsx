import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'
import { ViewHeader, Button, Pill, ErrorBanner, EmptyState, Modal, classNames } from '../components/ui'
import { AddProviderModal } from '../components/AddProviderModal'
import { EditProviderModal } from '../components/EditProviderModal'

export function ProvidersView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [types, setTypes] = useState<ProviderTypeDescriptor[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<ProviderWithCredential | null>(null)
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

  async function handleDelete(p: ProviderWithCredential) {
    await window.meowGateway.deleteProvider(p.id)
    await refresh()
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
          Add Provider
        </Button>
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      {providers.length === 0 && (
        <EmptyState icon="⇄" title="No providers yet" hint="Add a provider to start routing model traffic." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {providers.map((p) => (
          <div key={p.id} className={classNames('panel', p.enabled ? '' : 'panel--off')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="rail__logo" style={{ width: 26, height: 26, fontSize: 'var(--fs-3)' }} aria-hidden="true">
                {p.display_name.charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-3)', letterSpacing: '0.02em' }}>
                    {p.display_name}
                  </strong>
                  <Pill tone={p.enabled ? 'ok' : 'muted'}>{p.enabled ? 'enabled' : 'disabled'}</Pill>
                  {p.hasCredential ? <Pill tone="ok">key set</Pill> : <Pill tone="warn">no key</Pill>}
                </div>
                <div className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)', marginTop: 4 }}>
                  {p.type} <span style={{ color: 'var(--text-faint)' }}>·</span> {p.base_url || 'default endpoint'}
                </div>
              </div>
              <div className="view-actions">
                <Button onClick={() => setEditing(p)}>Edit</Button>
                <Button onClick={() => handleToggle(p)}>{p.enabled ? 'Disable' : 'Enable'}</Button>
                <Button onClick={() => handleTest(p)}>Test</Button>
                <Button onClick={() => handleDiscover(p)}>Sync Models</Button>
                <Button variant="danger" onClick={() => handleDelete(p)}>Delete</Button>
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
    </div>
  )
}
