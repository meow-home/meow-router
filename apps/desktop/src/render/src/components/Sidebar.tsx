import logo from '../assets/logo.png'
import { Pill } from './ui'

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
      </div>
    </aside>
  )
}
