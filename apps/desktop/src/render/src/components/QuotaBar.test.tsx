import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotaBar } from './QuotaBar'
import type { QuotaItem } from '@meow-gateway/provider-antigravity'

afterEach(() => {
  vi.useRealTimers()
})

function item(overrides: Partial<QuotaItem> = {}): QuotaItem {
  return { key: 'claude:5h', label: 'Claude (5h)', percentage: 50, resetTime: '', ...overrides }
}

describe('QuotaBar', () => {
  it('renders label and percentage', () => {
    render(<QuotaBar item={item({ percentage: 65 })} />)
    expect(screen.getByText('Claude (5h)')).toBeTruthy()
    expect(screen.getByText('65%')).toBeTruthy()
  })

  it('uses ok tone when percentage > 30', () => {
    const { container } = render(<QuotaBar item={item({ percentage: 65 })} />)
    expect(container.querySelector('.quota-bar-fill--ok')).toBeTruthy()
  })

  it('uses warn tone when percentage is 10-30', () => {
    const { container } = render(<QuotaBar item={item({ percentage: 20 })} />)
    expect(container.querySelector('.quota-bar-fill--warn')).toBeTruthy()
  })

  it('uses fault tone when percentage <= 10', () => {
    const { container } = render(<QuotaBar item={item({ percentage: 5 })} />)
    expect(container.querySelector('.quota-bar-fill--fault')).toBeTruthy()
  })

  it('uses fault tone at 0%', () => {
    const { container } = render(<QuotaBar item={item({ percentage: 0 })} />)
    expect(container.querySelector('.quota-bar-fill--fault')).toBeTruthy()
  })

  it('uses ok tone at 100%', () => {
    const { container } = render(<QuotaBar item={item({ percentage: 100 })} />)
    expect(container.querySelector('.quota-bar-fill--ok')).toBeTruthy()
  })

  it('shows ~Nh format for a future reset time within a day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const { container } = render(<QuotaBar item={item({ resetTime: '2026-09-09T05:00:00Z' })} />)
    expect(container.querySelector('.quota-bar-meta')?.textContent).toContain('~5h')
  })

  it('shows ~Nd Mh format for a future reset time beyond a day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const { container } = render(<QuotaBar item={item({ resetTime: '2026-09-12T03:00:00Z' })} />)
    expect(container.querySelector('.quota-bar-meta')?.textContent).toContain('~3d 3h')
  })

  it('renders no meta div when reset time is empty', () => {
    const { container } = render(<QuotaBar item={item({ resetTime: '' })} />)
    expect(container.querySelector('.quota-bar-meta')).toBeNull()
  })

  it('shows resetting… for a past reset time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const { container } = render(<QuotaBar item={item({ resetTime: '2026-09-08T00:00:00Z' })} />)
    expect(container.querySelector('.quota-bar-meta')?.textContent).toBe('resetting…')
  })

  it('sets correct aria-valuenow on the progressbar', () => {
    const { container } = render(<QuotaBar item={item({ percentage: 42 })} />)
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe('100')
  })
})
