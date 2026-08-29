import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the gateway running state in the footer', async () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} running />)
    expect(await screen.findByText(/gateway up/i)).toBeTruthy()
  })

  it('shows the app version in the footer', async () => {
    ;(window.meowGateway as unknown as { getAppVersion: ReturnType<typeof vi.fn> }).getAppVersion.mockResolvedValue('0.1.0')
    render(<Sidebar active="providers" onSelect={vi.fn()} running />)
    expect(await screen.findByText(/v0\.1\.0/)).toBeTruthy()
  })
})
