import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GatewayView } from './GatewayView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('GatewayView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.gatewayGetStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 8317 })
    gw.gatewayGetConfig.mockResolvedValue({ id: 1, host: '127.0.0.1', port: 8317, auth_enabled: false, startup_enabled: false })
  })

  it('shows running status and host:port', async () => {
    render(<GatewayView />)
    expect(await screen.findByText(/127.0.0.1:8317/)).toBeTruthy()
  })

  it('stops the gateway', async () => {
    gw.gatewayStop.mockResolvedValue({ running: false, host: '127.0.0.1', port: 8317 })
    render(<GatewayView />)
    fireEvent.click(await screen.findByText(/Stop/))
    await waitFor(() => expect(gw.gatewayStop).toHaveBeenCalled())
  })
})
