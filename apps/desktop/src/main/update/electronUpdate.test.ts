import { describe, it, expect, vi } from 'vitest'
import { UpdateManager, verifyDigest } from './updateManager'

describe('electronUpdate wiring contract', () => {
  it('verifyDigest rejects a checksum mismatch', () => {
    expect(verifyDigest('deadbeef', 'sha256:cafebabe')).toBe(false)
  })

  it('creates a manager exposing the public surface', () => {
    const m = new UpdateManager({
      getCurrentVersion: () => '0.3.0',
      getPlatform: () => 'win32',
      getArch: () => 'x64',
      getDownloadDir: async () => '/tmp',
      httpGetJson: vi.fn(),
      downloadToFile: vi.fn(),
      openPath: vi.fn(),
      notify: vi.fn()
    })
    expect(typeof m.checkForUpdate).toBe('function')
    expect(typeof m.startDownload).toBe('function')
    expect(typeof m.getStatus).toBe('function')
    expect(typeof m.openInstaller).toBe('function')
    expect(typeof m.onDownloadComplete).toBe('function')
  })
})
