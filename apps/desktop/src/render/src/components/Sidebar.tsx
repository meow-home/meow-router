import { useEffect, useState } from 'react'
import logo from '../assets/logo.png'
import { Pill, Button } from './ui'
import { UpdateModal } from './UpdateModal'
import type { UpdateCheckResult, UpdateDownloadState } from '@shared/ipc'

export type View = 'providers' | 'models' | 'virtualmodels' | 'gateway' | 'dashboard'

const items: Array<{ id: View; label: string; index: string }> = [
  { id: 'gateway', label: 'Gateway', index: '01' },
  { id: 'providers', label: 'Providers', index: '02' },
  { id: 'models', label: 'Models', index: '03' },
  { id: 'virtualmodels', label: 'Virtual Models', index: '04' },
  { id: 'dashboard', label: 'Usage', index: '05' },
]

export function Sidebar({
  active,
  onSelect,
  running,
}: {
  active: View
  onSelect: (v: View) => void
  running: boolean
}) {
  const [version, setVersion] = useState('')
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateDownloadState>({ status: 'idle' })
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.meowGateway.getAppVersion().then(setVersion).catch(() => setVersion(''))
  }, [])

  const handleCheckUpdate = async () => {
    setChecking(true)
    try {
      const res = await window.meowGateway.checkForUpdates()
      setUpdateResult(res)
      setUpdateStatus({ status: 'idle' })
      setUpdateOpen(true)
    } catch {
      setUpdateResult({ latestVersion: '', currentVersion: '', hasUpdate: false, releaseUrl: '', releaseName: '', publishedAt: '' })
      setUpdateOpen(true)
    } finally {
      setChecking(false)
    }
  }

  return (
    <aside className="rail">
      <div className="rail__brand">
        <img className="rail__logo" src={logo} alt="Meow Gateway logo" width={30} height={30} />
        <div>
          <div className="rail__name">MEOW</div>
          <div className="rail__tag">GATEWAY</div>
        </div>
      </div>

      <nav className="rail__nav" aria-label="Sections">
        {items.map((it) => (
          <button
            key={it.id}
            className={`rail__item ${active === it.id ? 'is-active' : ''}`}
            onClick={() => onSelect(it.id)}
            aria-current={active === it.id ? 'page' : undefined}
          >
            <span className="rail__item-index">{it.index}</span>
            {it.label}
          </button>
        ))}
      </nav>

      <div className="rail__footer">
        <div className="rail__status">
          <Pill tone={running ? 'live' : 'muted'}>{running ? 'gateway up' : 'gateway down'}</Pill>
        </div>
        <span>endpoint 127.0.0.1</span>
        <span style={{ color: 'var(--text-faint)' }}>port 8317 / v1</span>
        <span style={{ color: 'var(--text-faint)' }}>{version ? `v${version}` : 'v—'}</span>
        <Button variant="ghost" onClick={handleCheckUpdate} disabled={checking}>
          {checking ? 'Checking…' : 'Check update'}
        </Button>
      </div>
      {updateResult && (
        <UpdateModal open={updateOpen} result={updateResult} status={updateStatus} onClose={() => setUpdateOpen(false)} />
      )}
    </aside>
  )
}
