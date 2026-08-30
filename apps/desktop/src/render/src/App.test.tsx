import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from './App'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

const updateAvailable = {
  latestVersion: '0.4.0', currentVersion: '0.3.0', hasUpdate: true,
  releaseUrl: 'https://r', releaseName: 'v0.4.0', publishedAt: '',
  downloadUrl: 'https://dl/w.exe', assetName: 'Meow_gateway_0.4.0_x64.exe'
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.checkForUpdates.mockResolvedValue({ latestVersion: '0.3.0', currentVersion: '0.3.0', hasUpdate: false, releaseUrl: '', releaseName: '', publishedAt: '' })
    gw.getUpdateStatus.mockResolvedValue({ status: 'idle' })
  })

  it('renders the providers view by default', async () => {
    render(<App />)
    expect(await screen.findAllByText('Providers')).toBeTruthy()
    expect(screen.getByText('Add Provider')).toBeTruthy()
  })

  it('navigates to the gateway view', async () => {
    render(<App />)
    const btn = await screen.findByRole('button', { name: /Gateway/i })
    btn.click()
    expect(await screen.findByText(/Require gateway API key/i)).toBeTruthy()
    expect(screen.queryByText('Add Provider')).toBeNull()
  })

  it('opens the update modal when the auto-check finds an update', async () => {
    gw.checkForUpdates.mockResolvedValue(updateAvailable)
    render(<App />)
    expect(await screen.findByText('Download & Install')).toBeTruthy()
  })

  it('calls getUpdateStatus while downloading and shows live progress', async () => {
    gw.checkForUpdates.mockResolvedValue(updateAvailable)
    gw.getUpdateStatus.mockResolvedValue({ status: 'downloading', progress: 0.4 })
    render(<App />)
    await screen.findByText('Download & Install')
    fireEvent.click(screen.getByText('Download & Install'))
    expect(screen.getByText('Downloading 0%')).toBeTruthy()

    await waitFor(() => {
      expect(gw.getUpdateStatus).toHaveBeenCalled()
      expect(screen.getByText('Downloading 40%')).toBeTruthy()
    }, { timeout: 3000 })
  })
})
