import { compareSemver, selectAsset } from './version'
import type { UpdateCheckResult, UpdateDownloadState, UpdateDownloadAction } from '../../shared/ipc'

export interface UpdateManagerDependencies {
  getCurrentVersion: () => string
  getPlatform: () => string
  getArch: () => string
  getDownloadDir: () => Promise<string>
  httpGetJson: (url: string) => Promise<unknown>
  downloadToFile: (url: string, dest: string, onProgress: (p: number) => void) => Promise<string>
  openPath: (path: string) => Promise<void>
  notify: (title: string, body: string) => void
}

const REPO = 'meow-home/meow-router'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`

// Best-effort digest verification. Matches the spec: if the release exposes a
// `sha256:<hex>` digest, the computed hash must match; if no digest is exposed,
// the download succeeds (integrity verification is not a substitute for code
// signing, which is out of scope).
export function verifyDigest(computedHex: string, expected?: string): boolean {
  if (!expected) return true
  return expected.trim().toLowerCase() === `sha256:${computedHex.toLowerCase()}`
}

export class UpdateManager {
  private state: UpdateDownloadState = { status: 'idle' }
  private completeListeners: Array<() => void> = []

  constructor(private deps: UpdateManagerDependencies) {}

  onDownloadComplete(cb: () => void): void {
    this.completeListeners.push(cb)
  }

  getStatus(): UpdateDownloadState {
    return this.state
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    const current = this.deps.getCurrentVersion()
    const payload = await this.deps.httpGetJson(LATEST_URL) as Record<string, unknown>
    const tagName = String(payload['tag_name'] ?? '')
    const prerelease = Boolean(payload['prerelease'])
    const draft = Boolean(payload['draft'])
    const latestVersion = tagName.replace(/^v/i, '')

    const assets = ((payload['assets'] as Array<Record<string, unknown>>) ?? [])
      .map((a) => ({ name: String(a['name']), downloadUrl: String(a['browser_download_url']), digest: a['digest'] as string | undefined }))
      .filter((a) => a.name.length > 0)

    // releases/latest returns the newest stable release already; filter defensively.
    const stable = prerelease || draft ? [] : assets
    const hasUpdate = !prerelease && !draft && compareSemver(latestVersion, current) > 0
    const selected = hasUpdate ? selectAsset(stable, this.deps.getPlatform(), this.deps.getArch()) : undefined

    return {
      latestVersion,
      currentVersion: current,
      hasUpdate,
      releaseUrl: String(payload['html_url'] ?? ''),
      releaseName: tagName,
      publishedAt: String(payload['published_at'] ?? ''),
      downloadUrl: selected?.downloadUrl,
      assetName: selected?.name,
      digest: selected?.digest
    }
  }

  async startDownload(dl: UpdateDownloadAction, expectedDigest?: string): Promise<void> {
    this.state = { status: 'downloading', progress: 0 }
    try {
      const dir = await this.deps.getDownloadDir()
      const dest = `${dir}/${dl.assetName}`
      const computed = await this.deps.downloadToFile(dl.downloadUrl, dest, (p) => { this.state = { status: 'downloading', progress: p } })
      if (!verifyDigest(computed, expectedDigest)) {
        throw new Error('Download failed verification (checksum mismatch). The installer was not opened.')
      }
      this.state = { status: 'downloaded', filePath: dest }
      this.deps.notify('Update ready', `Meow Gateway ${dl.assetName} has been downloaded. Click to install.`)
      for (const cb of this.completeListeners) cb()
    } catch (err) {
      this.state = { status: 'error', message: err instanceof Error ? err.message : 'Download failed' }
    }
  }

  async openInstaller(): Promise<boolean> {
    if (this.state.status !== 'downloaded') return false
    await this.deps.openPath(this.state.filePath)
    return true
  }
}
