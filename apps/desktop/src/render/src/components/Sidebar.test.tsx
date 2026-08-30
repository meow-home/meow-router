import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the gateway running state in the footer', async () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} running onCheckUpdate={vi.fn()} />)
    expect(await screen.findByText(/gateway up/i)).toBeTruthy()
  })

  it('shows the app version in the footer', async () => {
    ;(window.meowGateway as unknown as { getAppVersion: ReturnType<typeof vi.fn> }).getAppVersion.mockResolvedValue('0.1.0')
    render(<Sidebar active="providers" onSelect={vi.fn()} running onCheckUpdate={vi.fn()} />)
    expect(await screen.findByText(/v0\.1\.0/)).toBeTruthy()
  })

  it('renders a Check update button in the footer', () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} running onCheckUpdate={vi.fn()} />)
    expect(screen.getByText(/Check update/i)).toBeTruthy()
  })

  it('calls onCheckUpdate when Check update is clicked', () => {
    const onCheckUpdate = vi.fn()
    render(<Sidebar active="providers" onSelect={vi.fn()} running onCheckUpdate={onCheckUpdate} />)
    fireEvent.click(screen.getByText(/Check update/i))
    expect(onCheckUpdate).toHaveBeenCalled()
  })

  it('shows Checking… when the checking prop is true', () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} running checking onCheckUpdate={vi.fn()} />)
    expect(screen.getByText(/Checking…/i)).toBeTruthy()
  })
})
