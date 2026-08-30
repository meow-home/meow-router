import { describe, it, expect, vi } from 'vitest'
import { UpdateManager, type UpdateManagerDependencies } from './updateManager'

// Latest release payload shape (subset of GitHub /releases/latest)
const releasePayload = {
  tag_name: 'v0.4.0',
  prerelease: false,
  draft: false,
  published_at: '2026-08-01T00:00:00Z',
  html_url: 'https://github.com/meow-home/meow-router/releases/tag/v0.4.0',
  assets: [
    { name: 'Meow_gateway_0.4.0_x64.exe', browser_download_url: 'https://dl/w.exe', digest: 'sha256:deadbeef' },
    { name: 'Meow_gateway_0.4.0_x86_64.AppImage', browser_download_url: 'https://dl/a.AppImage', digest: 'sha256:cafe' }
  ]
}

function makeDeps(overrides: Partial<UpdateManagerDependencies> = {}): UpdateManagerDependencies {
  return {
    getCurrentVersion: () => '0.3.0',
    getPlatform: () => 'win32',
    getArch: () => 'x64',
    getDownloadDir: async () => '/tmp/dl',
    httpGetJson: vi.fn().mockResolvedValue(releasePayload),
    downloadToFile: vi.fn().mockResolvedValue('deadbeef'),
    openPath: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    ...overrides
  }
}

describe('UpdateManager.checkForUpdate', () => {
  it('reports hasUpdate true when latest > current', async () => {
    const m = new UpdateManager(makeDeps())
    const res = await m.checkForUpdate()
    expect(res.hasUpdate).toBe(true)
    expect(res.latestVersion).toBe('0.4.0')
    expect(res.currentVersion).toBe('0.3.0')
    expect(res.assetName).toBe('Meow_gateway_0.4.0_x64.exe')
    expect(res.downloadUrl).toBe('https://dl/w.exe')
  })

  it('reports hasUpdate false when latest <= current', async () => {
    const m = new UpdateManager(makeDeps({ getCurrentVersion: () => '0.4.0' }))
    const res = await m.checkForUpdate()
    expect(res.hasUpdate).toBe(false)
    expect(res.downloadUrl).toBeUndefined()
  })

  it('leaves downloadUrl undefined when no asset matches', async () => {
    const m = new UpdateManager(makeDeps({ getPlatform: () => 'freebsd' }))
    const res = await m.checkForUpdate()
    expect(res.hasUpdate).toBe(true)
    expect(res.downloadUrl).toBeUndefined()
  })
})

describe('UpdateManager download state machine', () => {
  it('starts idle, goes downloading then downloaded on success', async () => {
    const deps = makeDeps()
    const m = new UpdateManager(deps)
    expect(m.getStatus()).toEqual({ status: 'idle' })
    await m.startDownload({ downloadUrl: 'https://dl/w.exe', assetName: 'Meow_gateway_0.4.0_x64.exe' }, 'sha256:deadbeef')
    expect(m.getStatus()).toEqual({ status: 'downloaded', filePath: '/tmp/dl/Meow_gateway_0.4.0_x64.exe' })
    expect(deps.notify).toHaveBeenCalled()
  })

  it('goes to error when digest does not match', async () => {
    const m = new UpdateManager(makeDeps())
    await m.startDownload({ downloadUrl: 'https://dl/w.exe', assetName: 'w.exe' }, 'sha256:cafebabe')
    expect(m.getStatus()).toMatchObject({ status: 'error' })
  })

  it('goes to error when downloadToFile fails', async () => {
    const m = new UpdateManager(makeDeps({ downloadToFile: vi.fn().mockRejectedValue(new Error('boom')) }))
    await m.startDownload({ downloadUrl: 'https://dl/w.exe', assetName: 'w.exe' }, 'sha256:deadbeef')
    expect(m.getStatus()).toMatchObject({ status: 'error' })
  })

  it('opens the downloaded installer', async () => {
    const deps = makeDeps()
    const m = new UpdateManager(deps)
    await m.startDownload({ downloadUrl: 'https://dl/w.exe', assetName: 'w.exe' }, 'sha256:deadbeef')
    const ok = await m.openInstaller()
    expect(ok).toBe(true)
    expect(deps.openPath).toHaveBeenCalled()
  })

  it('openInstaller returns false when not downloaded', async () => {
    const m = new UpdateManager(makeDeps())
    expect(await m.openInstaller()).toBe(false)
  })

  it('fires onDownloadComplete listeners', async () => {
    const cb = vi.fn()
    const m = new UpdateManager(makeDeps())
    m.onDownloadComplete(cb)
    await m.startDownload({ downloadUrl: 'https://dl/w.exe', assetName: 'w.exe' }, 'sha256:deadbeef')
    expect(cb).toHaveBeenCalled()
  })
})
