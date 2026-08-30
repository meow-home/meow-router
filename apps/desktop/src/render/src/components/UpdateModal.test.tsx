import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UpdateModal } from './UpdateModal'
import type { UpdateCheckResult } from '@shared/ipc'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

const updateAvailable: UpdateCheckResult = {
  latestVersion: '0.4.0', currentVersion: '0.3.0', hasUpdate: true,
  releaseUrl: 'https://r', releaseName: 'v0.4.0', publishedAt: '',
  downloadUrl: 'https://dl/w.exe', assetName: 'Meow_gateway_0.4.0_x64.exe'
}

describe('UpdateModal', () => {
  it('shows the latest-version message when no update', () => {
    render(<UpdateModal open onClose={vi.fn()} result={{ latestVersion: '0.3.0', currentVersion: '0.3.0', hasUpdate: false, releaseUrl: '', releaseName: '', publishedAt: '' } as UpdateCheckResult} status={{ status: 'idle' }} />)
    expect(screen.getByText(/latest version/i)).toBeTruthy()
  })

  it('shows a Download & Install button when an update is available', () => {
    render(<UpdateModal open onClose={vi.fn()} result={updateAvailable} status={{ status: 'idle' }} />)
    expect(screen.getByText('Download & Install')).toBeTruthy()
  })

  it('calls startUpdateDownload on Download & Install', () => {
    render(<UpdateModal open onClose={vi.fn()} result={updateAvailable} status={{ status: 'idle' }} />)
    fireEvent.click(screen.getByText('Download & Install'))
    expect(gw.startUpdateDownload).toHaveBeenCalled()
  })

  it('shows progress while downloading', () => {
    render(<UpdateModal open onClose={vi.fn()} result={updateAvailable} status={{ status: 'downloading', progress: 0.5 }} />)
    expect(screen.getByText(/Downloading/i)).toBeTruthy()
  })

  it('shows Install Now when downloaded', () => {
    render(<UpdateModal open onClose={vi.fn()} result={updateAvailable} status={{ status: 'downloaded', filePath: '/tmp/w.exe' }} />)
    expect(screen.getByText('Install Now')).toBeTruthy()
  })

  it('calls openUpdateInstaller on Install Now', () => {
    render(<UpdateModal open onClose={vi.fn()} result={updateAvailable} status={{ status: 'downloaded', filePath: '/tmp/w.exe' }} />)
    fireEvent.click(screen.getByText('Install Now'))
    expect(gw.openUpdateInstaller).toHaveBeenCalled()
  })

  it('can be closed while downloading', () => {
    const onClose = vi.fn()
    render(<UpdateModal open onClose={onClose} result={updateAvailable} status={{ status: 'downloading', progress: 0.5 }} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the no-installer message and hides the download button when no asset matches', () => {
    const result: UpdateCheckResult = {
      latestVersion: '0.4.0', currentVersion: '0.3.0', hasUpdate: true,
      releaseUrl: 'https://r', releaseName: 'v0.4.0', publishedAt: '',
      downloadUrl: undefined, assetName: undefined
    }
    render(<UpdateModal open onClose={vi.fn()} result={result} status={{ status: 'idle' }} />)
    expect(screen.getByText(/No installer is available for your platform yet/i)).toBeTruthy()
    expect(screen.queryByText('Download & Install')).toBeNull()
  })

  it('does not render a Retry button when no asset matches and download errored', () => {
    const result: UpdateCheckResult = {
      latestVersion: '0.4.0', currentVersion: '0.3.0', hasUpdate: true,
      releaseUrl: 'https://r', releaseName: 'v0.4.0', publishedAt: '',
      downloadUrl: undefined, assetName: undefined
    }
    render(<UpdateModal open onClose={vi.fn()} result={result} status={{ status: 'error', message: 'boom' }} />)
    expect(screen.getByText(/Download failed: boom/i)).toBeTruthy()
    expect(screen.queryByText('Retry')).toBeNull()
  })
})
