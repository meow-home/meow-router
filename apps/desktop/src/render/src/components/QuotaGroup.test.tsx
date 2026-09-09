import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotaGroup } from './QuotaGroup'
import type { QuotaItem } from '@meow-gateway/provider-antigravity'

function item(key: string, label: string, percentage: number): QuotaItem {
  return { key, label, percentage, resetTime: '' }
}

const full = [
  item('claude:5h', 'Claude (5h)', 65),
  item('claude:weekly', 'Claude (Weekly)', 40),
  item('gemini:5h', 'Gemini (5h)', 20),
  item('gemini:weekly', 'Gemini (Weekly)', 80),
]

describe('QuotaGroup', () => {
  it('renders Claude and Gemini column titles', () => {
    render(<QuotaGroup items={full} />)
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('Gemini')).toBeTruthy()
  })

  it('renders all four bars with percentages', () => {
    render(<QuotaGroup items={full} />)
    expect(screen.getByText('65%')).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
  })

  it('renders empty 100% bars for missing slots', () => {
    render(<QuotaGroup items={[item('claude:5h', 'Claude (5h)', 65)]} />)
    // Claude weekly missing -> 100% bar; Gemini both missing -> 100% bars
    expect(screen.getAllByText('100%').length).toBe(3)
  })

  it('renders nothing when items is empty', () => {
    const { container } = render(<QuotaGroup items={[]} />)
    expect(container.querySelector('.quota-group')).toBeNull()
  })
})
