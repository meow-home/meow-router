import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseQuotaResponse, type RawQuotaResponse } from './quotaParser'

afterEach(() => {
  vi.useRealTimers()
})

describe('parseQuotaResponse', () => {
  it('parses retrieveUserQuotaSummary buckets into quota keys', () => {
    const raw: RawQuotaResponse = {
      models: {},
      quotaSummary: {
        groups: [{
          buckets: [
            { bucketId: '3p-5h', displayName: 'Claude (5h)', remainingFraction: 0.65, resetTime: '2026-09-09T12:00:00Z' },
            { bucketId: '3p-weekly', displayName: 'Claude (Weekly)', remainingFraction: 0.4, resetTime: '2026-09-14T00:00:00Z' },
            { bucketId: 'gemini-5h', displayName: 'Gemini (5h)', remainingFraction: 0.85, resetTime: '2026-09-09T13:00:00Z' },
            { bucketId: 'gemini-weekly', displayName: 'Gemini (Weekly)', remainingFraction: 0.92, resetTime: '2026-09-14T00:00:00Z' }
          ]
        }]
      }
    }
    const items = parseQuotaResponse(raw)
    expect(items.map((i) => i.key)).toEqual(['claude:5h', 'claude:weekly', 'gemini:5h', 'gemini:weekly'])
    expect(items.find((i) => i.key === 'claude:5h')).toMatchObject({ label: 'Claude (5h)', percentage: 65 })
    expect(items.find((i) => i.key === 'claude:weekly')).toMatchObject({ percentage: 40 })
    expect(items.find((i) => i.key === 'gemini:5h')).toMatchObject({ percentage: 85 })
    expect(items.find((i) => i.key === 'gemini:weekly')).toMatchObject({ percentage: 92 })
  })

  it('falls back to fetchAvailableModels model names when no summary', () => {
    const raw: RawQuotaResponse = {
      models: {
        'claude-3-5-sonnet-high': { displayName: 'Claude 3.5 Sonnet', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-09-09T12:00:00Z' } },
        'claude-3-5-sonnet-low': { displayName: 'Claude 3.5 Sonnet Low', quotaInfo: { remainingFraction: 0.3, resetTime: '2026-09-14T00:00:00Z' } },
        'gemini-2.5-flash': { displayName: 'Gemini 2.5 Flash', quotaInfo: { remainingFraction: 0.7, resetTime: '2026-09-09T13:00:00Z' } },
        'gemini-2.5-pro-low': { displayName: 'Gemini 2.5 Pro Low', quotaInfo: { remainingFraction: 0.2, resetTime: '2026-09-14T00:00:00Z' } }
      }
    }
    const items = parseQuotaResponse(raw)
    expect(items.map((i) => i.key).sort()).toEqual(['claude:5h', 'claude:weekly', 'gemini:5h', 'gemini:weekly'])
    expect(items.find((i) => i.key === 'claude:5h')).toMatchObject({ label: 'Claude 3.5 Sonnet', percentage: 50 })
    expect(items.find((i) => i.key === 'claude:weekly')).toMatchObject({ percentage: 30 })
    expect(items.find((i) => i.key === 'gemini:5h')).toMatchObject({ percentage: 70 })
    expect(items.find((i) => i.key === 'gemini:weekly')).toMatchObject({ percentage: 20 })
  })

  it('gives quota summary priority over model name match for the same key', () => {
    const raw: RawQuotaResponse = {
      models: {
        'claude-3-5-sonnet-high': { displayName: 'Model Claude', quotaInfo: { remainingFraction: 0.1, resetTime: '2026-09-09T12:00:00Z' } }
      },
      quotaSummary: {
        groups: [{
          buckets: [
            { bucketId: '3p-5h', displayName: 'Claude (5h)', remainingFraction: 0.9, resetTime: '2026-09-09T12:00:00Z' }
          ]
        }]
      }
    }
    const items = parseQuotaResponse(raw)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'claude:5h', label: 'Claude (5h)', percentage: 90 })
  })

  it('returns empty array when both models and summary are empty', () => {
    expect(parseQuotaResponse({ models: {} })).toEqual([])
  })

  it('skips a model that has no quotaInfo', () => {
    const raw: RawQuotaResponse = {
      models: {
        'claude-3-5-sonnet-high': { displayName: 'Claude' },
        'gemini-2.5-flash': { displayName: 'Gemini', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-09-09T12:00:00Z' } }
      }
    }
    const items = parseQuotaResponse(raw)
    expect(items.map((i) => i.key)).toEqual(['gemini:5h'])
  })

  it('maps undefined remainingFraction to percentage 0', () => {
    const raw: RawQuotaResponse = {
      models: {
        'claude-3-5-sonnet-high': { displayName: 'Claude', quotaInfo: { resetTime: '2026-09-09T12:00:00Z' } }
      }
    }
    const items = parseQuotaResponse(raw)
    expect(items[0].percentage).toBe(0)
  })

  it('clamps remainingFraction above 1 to 100', () => {
    const raw: RawQuotaResponse = {
      models: {
        'claude-3-5-sonnet-high': { displayName: 'Claude', quotaInfo: { remainingFraction: 1.5, resetTime: '2026-09-09T12:00:00Z' } }
      }
    }
    expect(parseQuotaResponse(raw)[0].percentage).toBe(100)
  })

  it('clamps negative remainingFraction to 0', () => {
    const raw: RawQuotaResponse = {
      models: {
        'claude-3-5-sonnet-high': { displayName: 'Claude', quotaInfo: { remainingFraction: -0.1, resetTime: '2026-09-09T12:00:00Z' } }
      }
    }
    expect(parseQuotaResponse(raw)[0].percentage).toBe(0)
  })

  it('applies Gemini 5h override when reset time is more than 5h in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const raw: RawQuotaResponse = {
      models: {
        'gemini-2.5-flash': { displayName: 'Gemini', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-09-09T10:00:00Z' } }
      }
    }
    const items = parseQuotaResponse(raw)
    const gemini5h = items.find((i) => i.key === 'gemini:5h')!
    expect(gemini5h.percentage).toBe(100)
    expect(gemini5h.resetTime).toBe('')
  })

  it('leaves Gemini 5h unchanged when reset time is less than 5h in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const raw: RawQuotaResponse = {
      models: {
        'gemini-2.5-flash': { displayName: 'Gemini', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-09-09T02:00:00Z' } }
      }
    }
    const items = parseQuotaResponse(raw)
    const gemini5h = items.find((i) => i.key === 'gemini:5h')!
    expect(gemini5h.percentage).toBe(50)
    expect(gemini5h.resetTime).toBe('2026-09-09T02:00:00Z')
  })

  it('skips unknown bucket ids that are not claude/gemini', () => {
    const raw: RawQuotaResponse = {
      models: {},
      quotaSummary: {
        groups: [{
          buckets: [
            { bucketId: 'some-other-bucket', displayName: 'Other', remainingFraction: 0.5, resetTime: '2026-09-09T12:00:00Z' }
          ]
        }]
      }
    }
    expect(parseQuotaResponse(raw)).toEqual([])
  })

  it('uses bucket displayName as label when present, falls back to labelFor otherwise', () => {
    const raw: RawQuotaResponse = {
      models: {},
      quotaSummary: {
        groups: [{
          buckets: [
            { bucketId: '3p-5h', displayName: 'Custom Claude Label', remainingFraction: 0.5, resetTime: '2026-09-09T12:00:00Z' },
            { bucketId: '3p-weekly', remainingFraction: 0.5, resetTime: '2026-09-14T00:00:00Z' }
          ]
        }]
      }
    }
    const items = parseQuotaResponse(raw)
    expect(items.find((i) => i.key === 'claude:5h')!.label).toBe('Custom Claude Label')
    expect(items.find((i) => i.key === 'claude:weekly')!.label).toBe('Claude (Weekly)')
  })
})
