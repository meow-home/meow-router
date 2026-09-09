import type { QuotaItem } from '@meow-gateway/provider-antigravity'
import { QuotaBar } from './QuotaBar'

type SlotKey = '5h' | 'weekly'

const COLUMNS: Array<{ title: string; prefix: string }> = [
  { title: 'Claude', prefix: 'claude' },
  { title: 'Gemini', prefix: 'gemini' },
]

const SLOTS: SlotKey[] = ['5h', 'weekly']

function emptyItem(key: string, label: string): QuotaItem {
  return { key, label, percentage: 100, resetTime: '' }
}

export function QuotaGroup({ items }: { items: QuotaItem[] }) {
  if (items.length === 0) return null
  const byKey = new Map(items.map((i) => [i.key, i]))
  return (
    <div className="quota-group">
      {COLUMNS.map((col) => (
        <div className="quota-column" key={col.title}>
          <div className="quota-column-title">{col.title}</div>
          {SLOTS.map((slot) => {
            const key = `${col.prefix}:${slot}`
            const found = byKey.get(key)
            const label = found ? found.label : `${col.title} (${slot === '5h' ? '5h' : 'Weekly'})`
            return <QuotaBar key={key} item={found ?? emptyItem(key, label)} />
          })}
        </div>
      ))}
    </div>
  )
}
