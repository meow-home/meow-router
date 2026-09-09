// Pure quota parsing logic for Antigravity (Cloud Code Assist) accounts.
//
// Converts the raw JSON returned by the two Cloud Code Assist quota endpoints
// (fetchAvailableModels + retrieveUserQuotaSummary) into a flat list of
// `QuotaItem`s. This module is side-effect free and highly testable; the
// network calls live in the adapter, the polling/caching lives in QuotaService.

// The types that cross the IPC boundary. Defined here in the provider package
// so the parser is self-contained, then re-exported from the package index.
export interface QuotaItem {
  key: string
  label: string
  percentage: number
  resetTime: string
}

// Raw shape returned by AntigravityAdapter.getQuota(). Mirrors the Cloud Code
// Assist API responses from fetchAvailableModels + retrieveUserQuotaSummary.
export interface RawQuotaResponse {
  models: Record<
    string,
    {
      displayName?: string
      quotaInfo?: {
        remainingFraction?: number
        resetTime?: string
      }
    }
  >
  quotaSummary?: {
    groups?: Array<{
      buckets?: Array<{
        bucketId?: string
        displayName?: string
        remainingFraction?: number
        resetTime?: string
      }>
    }>
  }
  tier?: string
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function fractionToPercent(fraction: number | undefined): number {
  if (typeof fraction !== 'number' || isNaN(fraction)) return 0
  return clampPercent(fraction * 100)
}

// Label map for known bucket ids / model name keys.
const LABELS: Record<string, string> = {
  'claude:5h': 'Claude (5h)',
  'claude:weekly': 'Claude (Weekly)',
  'gemini:5h': 'Gemini (5h)',
  'gemini:weekly': 'Gemini (Weekly)',
}

function labelFor(key: string): string {
  return LABELS[key] ?? key
}

// Match a model name to a quota key. Priority order:
//   1. Exact bucket id match ('3p-5h', 'claude:5h', 'gemini-5h', etc.)
//   2. Fuzzy model name match (contains 'claude'/'gemini' + 'high'/'low'/'flash')
//
// Returns one of: 'claude:5h' | 'claude:weekly' | 'gemini:5h' | 'gemini:weekly' | null
function matchBucketKey(id: string): string | null {
  const lower = id.toLowerCase()

  // Exact bucket-id matches (from retrieveUserQuotaSummary)
  if (lower === '3p-5h' || lower === 'claude:5h') return 'claude:5h'
  if (lower === '3p-weekly' || lower === 'claude:weekly') return 'claude:weekly'
  if (lower === 'gemini-5h' || lower === 'gemini:5h') return 'gemini:5h'
  if (lower === 'gemini-weekly' || lower === 'gemini:weekly') return 'gemini:weekly'

  // Fuzzy model-name matches (from fetchAvailableModels fallback)
  const isClaude = lower.includes('claude')
  const isGemini = lower.includes('gemini')
  if (!isClaude && !isGemini) return null

  const isLow = lower.includes('low')

  if (isClaude) {
    // 'low' tier → weekly; everything else → 5h
    return isLow ? 'claude:weekly' : 'claude:5h'
  }
  if (isGemini) {
    // 'low' tier → weekly; 'high' or 'flash' → 5h; default → 5h
    return isLow ? 'gemini:weekly' : 'gemini:5h'
  }

  return null
}

// If a Gemini 5h reset time is more than 5 hours in the future, the weekly
// limit is capping the 5h limit. Override to 100% remaining and clear reset
// time. This mirrors cockpit-tools behavior.
function applyGemini5hOverride(items: QuotaItem[]): void {
  const gemini5h = items.find((i) => i.key === 'gemini:5h')
  if (!gemini5h || !gemini5h.resetTime) return
  const resetMs = Date.parse(gemini5h.resetTime)
  if (isNaN(resetMs)) return
  if (resetMs - Date.now() > FIVE_HOURS_MS) {
    gemini5h.percentage = 100
    gemini5h.resetTime = ''
  }
}

export function parseQuotaResponse(raw: RawQuotaResponse): QuotaItem[] {
  const items = new Map<string, QuotaItem>()

  // 1. Parse quota summary buckets (preferred source)
  if (raw.quotaSummary?.groups) {
    for (const group of raw.quotaSummary.groups) {
      if (!group.buckets) continue
      for (const bucket of group.buckets) {
        const key = matchBucketKey(bucket.bucketId ?? '')
        if (!key) continue
        // Don't overwrite if already set (first group wins)
        if (items.has(key)) continue
        items.set(key, {
          key,
          label: bucket.displayName || labelFor(key),
          percentage: fractionToPercent(bucket.remainingFraction),
          resetTime: bucket.resetTime ?? '',
        })
      }
    }
  }

  // 2. Fall back to fetchAvailableModels model-level quota
  for (const [modelName, info] of Object.entries(raw.models)) {
    if (!info.quotaInfo) continue
    const key = matchBucketKey(modelName)
    if (!key) continue
    if (items.has(key)) continue
    items.set(key, {
      key,
      label: info.displayName || labelFor(key),
      percentage: fractionToPercent(info.quotaInfo.remainingFraction),
      resetTime: info.quotaInfo.resetTime ?? '',
    })
  }

  const result = Array.from(items.values())
  applyGemini5hOverride(result)
  return result
}
