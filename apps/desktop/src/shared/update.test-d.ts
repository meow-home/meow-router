import type { WindowApi, UpdateCheckResult, UpdateDownloadState, UpdateDownloadAction } from './ipc'

// @ts-expect-error — missing required field
export const _bad: UpdateCheckResult = { latestVersion: '0.1.0' }

// Exported so tsc (noUnusedLocals) does not reject them; they are
// type-level assertions, not runtime values.
export const _good: UpdateCheckResult = {
  latestVersion: '0.4.0',
  currentVersion: '0.3.0',
  hasUpdate: true,
  releaseUrl: 'https://github.com/meow-home/meow-router/releases/tag/v0.4.0',
  releaseName: 'v0.4.0',
  publishedAt: '2026-08-01T00:00:00Z',
  downloadUrl: 'https://github.com/meow-home/meow-router/releases/download/v0.4.0/Meow_gateway_0.4.0_x64.exe',
  assetName: 'Meow_gateway_0.4.0_x64.exe',
  digest: 'sha256:deadbeef'
}

export const _state: UpdateDownloadState = { status: 'downloading', progress: 0.5 }
export const _dl: UpdateDownloadAction = { downloadUrl: 'https://x', assetName: 'a.exe', digest: 'sha256:deadbeef' }

declare const api: WindowApi

// Exported type-level assertions that the WindowApi methods exist with the
// right signatures; they are type assertions, not runtime values.
export const _checkForUpdates: Promise<UpdateCheckResult> = api.checkForUpdates()
export const _startUpdateDownload: Promise<void> = api.startUpdateDownload(_dl)
export const _getUpdateStatus: Promise<UpdateDownloadState> = api.getUpdateStatus()
export const _openUpdateInstaller: Promise<boolean> = api.openUpdateInstaller()
