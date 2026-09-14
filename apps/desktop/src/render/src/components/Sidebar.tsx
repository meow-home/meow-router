import { useEffect, useState } from 'react'
import {
  Server, Layers, Cpu, Route, Key, BarChart3, Sun, Moon, RefreshCw, Activity, Network, Boxes,
} from 'lucide-react'
import logo from '../assets/logo.png'
import { Button } from './ui'
import { getTheme, applyTheme, type Theme } from '../theme'

export type View = 'providers' | 'models' | 'virtualmodels' | 'gateway' | 'dashboard' | 'oauthaccounts'

const primaryItems: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'gateway', label: 'Gateway', icon: <Server size={15} /> },
  { id: 'providers', label: 'Providers', icon: <Layers size={15} /> },
]

const registryItems: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'models', label: 'Models', icon: <Cpu size={15} /> },
  { id: 'virtualmodels', label: 'Virtual Models', icon: <Route size={15} /> },
  { id: 'oauthaccounts', label: 'OAuth Accounts', icon: <Key size={15} /> },
]

const observationItems: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'Usage', icon: <BarChart3 size={15} /> },
]

function NavGroup({
  title,
  icon,
  items,
  active,
  onSelect,
}: {
  title: string
  icon?: React.ReactNode
  items: Array<{ id: View; label: string; icon: React.ReactNode }>
  active: View
  onSelect: (v: View) => void
}) {
  return (
    <div className="rail__nav-group">
      <div className="rail__section-title">
        {icon && <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 5 }}>{icon}</span>}
        {title}
      </div>
      <nav className="rail__nav" aria-label={title}>
        {items.map((it) => (
          <button
            key={it.id}
            className={`rail__item ${active === it.id ? 'is-active' : ''}`}
            onClick={() => onSelect(it.id)}
            aria-current={active === it.id ? 'page' : undefined}
          >
            <span className="rail__item-icon">{it.icon}</span>
            {it.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export function Sidebar({
  active,
  onSelect,
  checking = false,
  onCheckUpdate,
}: {
  active: View
  onSelect: (v: View) => void
  running?: boolean
  checking?: boolean
  onCheckUpdate: () => void
}) {
  const [version, setVersion] = useState('')
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme())

  useEffect(() => {
    let mounted = true
    window.meowGateway
      .getAppVersion()
      .then((v) => {
        if (mounted) setVersion(v)
      })
      .catch(() => {
        if (mounted) setVersion('')
      })
    return () => {
      mounted = false
    }
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
        <span className="rail__logo-badge">
          <img className="rail__logo" src={logo} alt="Meow Gateway logo" width={22} height={22} />
        </span>
        <div className="rail__brand-text">
          <div className="rail__name">MEOW</div>
          <div className="rail__tag">GATEWAY</div>
        </div>
      </div>

      <NavGroup title="Overview" icon={<Network size={11} />} items={primaryItems} active={active} onSelect={onSelect} />
      <NavGroup title="Registry" icon={<Boxes size={11} />} items={registryItems} active={active} onSelect={onSelect} />
      <NavGroup title="Insights" icon={<Activity size={11} />} items={observationItems} active={active} onSelect={onSelect} />

      <div className="rail__footer">
        <div className="rail__card-actions">
          <Button variant="ghost" onClick={toggleTheme} title="Toggle Dark/Light theme" style={{ flex: '0 0 38px', padding: '6px 8px' }}>
            {currentTheme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </Button>
          <Button variant="ghost" onClick={onCheckUpdate} disabled={checking} style={{ flex: 1, fontSize: '0.78rem' }}>
            <RefreshCw size={13} className={checking ? 'spin' : ''} style={{ marginRight: 4 }} />
            {checking ? 'Checking…' : 'Check update'}
          </Button>
        </div>

        <div className="rail__version">
          {version ? `v${version}` : 'v—'}
        </div>
      </div>
    </aside>
  )
}
