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

describe('gateway API key', () => {
  beforeEach(() => {
    gw.gatewayGetStatus.mockResolvedValue({ running: true, host: '127.0.0.1', port: 8317 })
    gw.gatewayGetConfig.mockResolvedValue({ id: 1, host: '127.0.0.1', port: 8317, auth_enabled: true, startup_enabled: false })
  })

  it('shows the masked key and never a raw one', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true })
    render(<GatewayView />)
    expect(await screen.findByText('mgw_•••••••••••1f4a')).toBeTruthy()
  })

  it('copies through the main process', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true })
    render(<GatewayView />)
    fireEvent.click(await screen.findByText('Copy'))
    await waitFor(() => expect(gw.gatewayCopyKey).toHaveBeenCalled())
  })

  it('asks for confirmation before regenerating', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: 'mgw_•••••••••••1f4a', present: true })
    gw.gatewayRegenerateKey.mockResolvedValue({ masked: 'mgw_•••••••••••beef', present: true })
    render(<GatewayView />)
    fireEvent.click(await screen.findByText('Regenerate'))
    expect(gw.gatewayRegenerateKey).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Regenerate key'))
    await waitFor(() => expect(gw.gatewayRegenerateKey).toHaveBeenCalled())
    expect(await screen.findByText('mgw_•••••••••••beef')).toBeTruthy()
  })

  it('reports a key that could not be read', async () => {
    gw.gatewayGetKeyInfo.mockResolvedValue({ masked: '', present: false })
    render(<GatewayView />)
    expect(await screen.findByText(/could not be read/i)).toBeTruthy()
  })
})
