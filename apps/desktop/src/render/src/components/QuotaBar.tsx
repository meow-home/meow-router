import type { QuotaItem } from '@meow-gateway/provider-antigravity'

function quotaTone(percentage: number): 'ok' | 'warn' | 'fault' {
  if (percentage <= 10) return 'fault'
  if (percentage <= 30) return 'warn'
  return 'ok'
}

function formatResetTime(resetTime: string): string {
  if (!resetTime) return ''
  const ms = Date.parse(resetTime)
  if (isNaN(ms)) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return 'resetting…'
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  if (days > 0) return `~${days}d ${remHours}h`
  return `~${hours}h`
}

export function QuotaBar({ item }: { item: QuotaItem }) {
  const tone = quotaTone(item.percentage)
  const resetLabel = formatResetTime(item.resetTime)
  return (
    <div className="quota-bar">
      <div className="quota-bar-head">
        <span className="quota-bar-label">{item.label}</span>
        <span className={`quota-bar-pct quota-bar-pct--${tone}`}>{item.percentage}%</span>
      </div>
      <div className="quota-bar-track" role="progressbar" aria-valuenow={item.percentage} aria-valuemin={0} aria-valuemax={100}>
        <div className={`quota-bar-fill quota-bar-fill--${tone}`} style={{ width: `${item.percentage}%` }} />
      </div>
      {resetLabel && <div className="quota-bar-meta">{resetLabel}</div>}
    </div>
  )
}
