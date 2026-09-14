import { useEffect, useState } from 'react'
import { Server, Layers, Cpu, Route, Key, BarChart3, Sun, Moon, RefreshCw } from 'lucide-react'
import logo from '../assets/logo.png'
import { Pill, Button } from './ui'
import { getTheme, applyTheme, type Theme } from '../theme'

export type View = 'providers' | 'models' | 'virtualmodels' | 'gateway' | 'dashboard' | 'oauthaccounts'

const items: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'gateway', label: 'Gateway', icon: <Server size={16} /> },
  { id: 'providers', label: 'Providers', icon: <Layers size={16} /> },
  { id: 'models', label: 'Models', icon: <Cpu size={16} /> },
  { id: 'virtualmodels', label: 'Virtual Models', icon: <Route size={16} /> },
  { id: 'oauthaccounts', label: 'OAuth Accounts', icon: <Key size={16} /> },
  { id: 'dashboard', label: 'Usage', icon: <BarChart3 size={16} /> },
]

export function Sidebar({
  active,
  onSelect,
  running,
  checking = false,
  onCheckUpdate,
}: {
  active: View
  onSelect: (v: View) => void
  running: boolean
  checking?: boolean
  onCheckUpdate: () => void
}) {
  const [version, setVersion] = useState('')
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme())

  useEffect(() => {
    window.meowGateway.getAppVersion().then(setVersion).catch(() => setVersion(''))
  }, [])

  const toggleTheme = () => {
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light'
    localStorage.setItem('meow.theme', nextTheme)
    applyTheme(nextTheme)
    setCurrentTheme(nextTheme)
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
            <span className="rail__item-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {it.icon}
            </span>
            {it.label}
          </button>
        ))}
      </nav>

      <div className="rail__footer">
        <div className="rail__status">
          <Pill tone={running ? 'live' : 'muted'}>{running ? 'gateway up' : 'gateway down'}</Pill>
        </div>
        <span>endpoint 127.0.0.1</span>
        <span style={{ color: 'var(--text-faint)' }}>port 17135 / v1</span>
        <span style={{ color: 'var(--text-faint)' }}>{version ? `v${version}` : 'v—'}</span>
        
        <div style={{ display: 'flex', gap: '6px', width: '100%', marginTop: '4px' }}>
          <Button variant="ghost" onClick={toggleTheme} title="Toggle Dark/Light theme" style={{ flex: '0 0 auto', padding: '6px 8px' }}>
            {currentTheme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </Button>
          <Button variant="ghost" onClick={onCheckUpdate} disabled={checking} style={{ flex: 1, fontSize: '0.8rem' }}>
            <RefreshCw size={13} className={checking ? 'spin' : ''} style={{ marginRight: '4px' }} />
            {checking ? 'Checking…' : 'Check update'}
          </Button>
        </div>
      </div>
    </aside>
  )
}
