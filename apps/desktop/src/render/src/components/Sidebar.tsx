export type View = 'providers' | 'models' | 'virtualmodels' | 'gateway' | 'dashboard'

const items: Array<{ id: View; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'virtualmodels', label: 'Virtual Models' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'dashboard', label: 'Dashboard' }
]

export function Sidebar({ active, onSelect }: { active: View; onSelect: (v: View) => void }) {
  return (
    <nav style={{ width: 220, background: '#161b26', padding: 12, minHeight: '100vh', borderRight: '1px solid #2a3040' }}>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onSelect(it.id)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 4,
            background: active === it.id ? '#2f3a52' : 'transparent', color: '#e6e6e6',
            border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace'
          }}
        >
          {it.label}
        </button>
      ))}
    </nav>
  )
}
