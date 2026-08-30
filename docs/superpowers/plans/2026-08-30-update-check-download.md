# Update Check & Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Check update" button to the sidebar footer that checks GitHub Releases, shows a popup, downloads the platform installer, verifies its SHA-256, opens it, and fires an OS notification when a background download completes.

**Architecture:** A new main-process `UpdateManager` owns all privileged operations (network via Electron `net`, filesystem, SHA-256 hashing, `shell.openPath`, and Electron `Notification`). The renderer only calls validated IPC methods and renders a new `UpdateModal`. `App.tsx` runs one auto-check on launch. Re-opening the popup after a completed background download is driven by an IPC event emitted from the main process.

**Tech Stack:** Electron (main/preload/render), Electron `net` + `shell` + `Notification`, Node `node:crypto` (SHA-256), React + TypeScript strict, Vitest + @testing-library/react (jsdom), CSS tokens in `meow.css`.

## Global Constraints

- TypeScript strict mode. `noUnusedLocals`/`noUnusedParameters` are on — no unused imports/vars.
- All privileged operations (network, filesystem, OS notification, opening files, session key) live ONLY in the main process. Renderer never touches `net`, `fs`, `shell`, or `Notification`.
- IPC handlers return the `IpcResult<T>` envelope `{ ok: true, data }` / `{ ok: false, error: { message, code } }`, matching the preload `invoke<T>()` helper. **A handler returning a raw value is a bug** (see the `getAppVersion` regression).
- Validate every IPC payload before use. `startUpdateDownload` must reject a missing/empty `downloadUrl` or `assetName`.
- Renderer never receives secrets. Only versions, URLs, progress, and state cross the boundary.
- Only stable releases are considered: non-prerelease, non-draft, tag `v*` from `github.com/meow-home/meow-router`.
- Tests required for every feature. Use the existing patterns: mock `window.meowGateway`, `vi.fn`, `waitFor`.
- Semver compare must treat `0.10.0 > 0.9.0` correctly.
- Asset selection preference per platform: win32 → `.exe`; darwin → `.dmg`; linux → `.AppImage` then `.deb`.
- No secrets in logs; do not log the downloaded file path or download URL by default.

---

### Task 1: Add update IPC channels and types to `shared/ipc.ts`

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`

**Interfaces:**
- Produces: `IPC_CHANNELS.update` (`check`, `getStatus`, `startDownload`, `openInstaller`), plus types `UpdateCheckResult`, `UpdateDownloadState`, `UpdateDownloadAction`, and the new `WindowApi` methods.

- [ ] **Step 1: Write the failing type test**

Create `apps/desktop/src/shared/update.test-d.ts` (type-only assertions run by `tsc`):

```ts
import type { WindowApi, UpdateCheckResult, UpdateDownloadState, UpdateDownloadAction, IPC_CHANNELS } from './ipc'

// @ts-expect-error — missing required field
const _bad: UpdateCheckResult = { latestVersion: '0.1.0' }

// Prefixed with underscore so tsc (noUnusedLocals) does not reject them;
// they are type-level assertions, not runtime values.
const _good: UpdateCheckResult = {
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

const _state: UpdateDownloadState = { status: 'downloading', progress: 0.5 }
const _dl: UpdateDownloadAction = { downloadUrl: 'https://x', assetName: 'a.exe', digest: 'sha256:deadbeef' }

declare const api: WindowApi
api.checkForUpdates(): Promise<UpdateCheckResult>
api.startUpdateDownload(dl): Promise<void>
api.getUpdateStatus(): Promise<UpdateDownloadState>
api.openUpdateInstaller(): Promise<boolean>

export {}
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: FAIL — `WindowApi` has no `checkForUpdates`, `UpdateCheckResult` not exported.

- [ ] **Step 3: Implement the types and channel constants**

In `apps/desktop/src/shared/ipc.ts`, add to `IPC_CHANNELS`:

```ts
update: {
  check: 'update:check',
  getStatus: 'update:get-status',
  startDownload: 'update:start-download',
  openInstaller: 'update:open-installer'
}
```

Add these exported types near the other types:

```ts
export interface UpdateCheckResult {
  latestVersion: string
  currentVersion: string
  hasUpdate: boolean
  releaseUrl: string
  releaseName: string
  publishedAt: string
  downloadUrl?: string
  assetName?: string
  digest?: string
}

export type UpdateDownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; filePath: string }
  | { status: 'error'; message: string }

export type UpdateDownloadAction = {
  downloadUrl: string
  assetName: string
  digest?: string
}
```

Add to `WindowApi` interface:

```ts
checkForUpdates(): Promise<UpdateCheckResult>
startUpdateDownload(dl: UpdateDownloadAction): Promise<void>
getUpdateStatus(): Promise<UpdateDownloadState>
openUpdateInstaller(): Promise<boolean>
onUpdateReady(cb: () => void): () => void
```

The `UpdateDownloadAction.digest` is optional; when present, main verifies the
downloaded file against it. `UpdateCheckResult` should also carry the digest for
the platform asset so the renderer can pass it back on download. Add `digest?`
to `UpdateCheckResult`:

- [ ] **Step 4: Run typecheck to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS (the type-test file resolves).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/update.test-d.ts
git commit -m "feat(update): add update IPC contract and types"
```

---

### Task 2: Extract and test the semver comparison + asset selection helpers

**Files:**
- Create: `apps/desktop/src/main/update/version.ts`
- Test: `apps/desktop/src/main/update/version.test.ts`

**Interfaces:**
- Produces: `compareSemver(a: string, b: string): number`, `selectAsset(assets: AssetMeta[], platform: string, arch: string): AssetMeta | undefined`.
  - `AssetMeta = { name: string; downloadUrl: string; digest?: string }`.
  - `compareSemver` maps a string like `"0.3.0"` to `{major,minor,patch}`, strips non-numeric suffix after a `-`/`+`, and returns `-1|0|1`.
  - `selectAsset` picks by platform then extension preference.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/main/update/version.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { compareSemver, selectAsset, type AssetMeta } from './version'

describe('compareSemver', () => {
  it('returns 1 when a > b (patch)', () => {
    expect(compareSemver('0.3.0', '0.2.0')).toBe(1)
  })
  it('returns -1 when a < b (minor)', () => {
    expect(compareSemver('0.2.0', '0.3.0')).toBe(-1)
  })
  it('handles two-digit segments (0.10.0 > 0.9.0)', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1)
  })
  it('returns 0 for equal versions', () => {
    expect(compareSemver('0.3.0', '0.3.0')).toBe(0)
  })
  it('ignores a leading v', () => {
    expect(compareSemver('v0.4.0', '0.3.0')).toBe(1)
  })
  it('ignores prerelease/build suffix', () => {
    expect(compareSemver('0.4.0-beta.1', '0.4.0-alpha.1')).toBe(0)
  })
})

describe('selectAsset', () => {
  const assets: AssetMeta[] = [
    { name: 'Meow_gateway_0.4.0_x64.exe', downloadUrl: 'u/w.exe', digest: 'sha256:aa' },
    { name: 'Meow_gateway_0.4.0_x64.dmg', downloadUrl: 'u/m.dmg', digest: 'sha256:bb' },
    { name: 'Meow_gateway_0.4.0_x86_64.AppImage', downloadUrl: 'u/l.AppImage', digest: 'sha256:cc' },
    { name: 'Meow_gateway_0.4.0_amd64.deb', downloadUrl: 'u/l.deb', digest: 'sha256:dd' }
  ]

  it('picks .exe on win32', () => {
    expect(selectAsset(assets, 'win32', 'x64')?.name).toBe('Meow_gateway_0.4.0_x64.exe')
  })
  it('picks .dmg on darwin', () => {
    expect(selectAsset(assets, 'darwin', 'x64')?.name).toBe('Meow_gateway_0.4.0_x64.dmg')
  })
  it('prefers .AppImage over .deb on linux', () => {
    expect(selectAsset(assets, 'linux', 'x64')?.name).toBe('Meow_gateway_0.4.0_x86_64.AppImage')
  })
  it('returns undefined when no asset matches', () => {
    expect(selectAsset(assets, 'freebsd', 'x64')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- version`
Expected: FAIL — `compareSemver` / `selectAsset` not exported.

- [ ] **Step 3: Implement `version.ts`**

Create `apps/desktop/src/main/update/version.ts`:

```ts
export interface AssetMeta {
  name: string
  downloadUrl: string
  digest?: string
}

export function compareSemver(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1
  return 0
}

function parse(v: string): { major: number; minor: number; patch: number } {
  const s = v.trim().replace(/^v/i, '').split(/[-+]/)[0]
  const [major = '0', minor = '0', patch = '0'] = s.split('.')
  return {
    major: Number(major) || 0,
    minor: Number(minor) || 0,
    patch: Number(patch) || 0
  }
}

const EXT_PREFERENCE: Record<string, string[]> = {
  win32: ['.exe'],
  darwin: ['.dmg'],
  linux: ['.AppImage', '.deb']
}

export function selectAsset(assets: AssetMeta[], platform: string, _arch: string): AssetMeta | undefined {
  const prefs = EXT_PREFERENCE[platform]
  if (!prefs) return undefined
  for (const ext of prefs) {
    const found = assets.find((a) => a.name.toLowerCase().endsWith(ext.toLowerCase()))
    if (found) return found
  }
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- version`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/update/version.ts apps/desktop/src/main/update/version.test.ts
git commit -m "feat(update): semver compare and asset selection helpers"
```

---

### Task 3: Implement `UpdateManager` (check, download, state, open, notification)

**Files:**
- Create: `apps/desktop/src/main/update/updateManager.ts`
- Test: `apps/desktop/src/main/update/updateManager.test.ts`

**Interfaces:**
- Depends on: `compareSemver`, `selectAsset`, `AssetMeta` (Task 2), `UpdateCheckResult`, `UpdateDownloadState`, `UpdateDownloadAction` (Task 1).
- Produces: `UpdateManager` with:
  - `constructor(deps: UpdateManagerDependencies)`
  - `checkForUpdate(): Promise<UpdateCheckResult>`
  - `startDownload(dl: UpdateDownloadAction, expectedDigest?: string): Promise<void>`
  - `getStatus(): UpdateDownloadState`
  - `openInstaller(): Promise<boolean>`
  - `onDownloadComplete(cb: () => void): void`
  - `UpdateManagerDependencies = { getCurrentVersion(): string; getPlatform(): string; getArch(): string; getDownloadDir(): Promise<string>; httpGetJson(url: string): Promise<unknown>; downloadToFile(url: string, dest: string, onProgress: (p: number) => void): Promise<string /* sha256 hex */>; openPath(path: string): Promise<void>; notify(title: string, body: string): void }`
  - `startDownload(dl: UpdateDownloadAction, expectedDigest?: string): Promise<void>` (verifies computed SHA-256 against `expectedDigest`)

  The deps are injected so tests run without a real network/Electron (per AGENTS.md dependency injection at process boundaries).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/update/updateManager.test.ts`. We inject fakes for the network/download/notify deps and assert the check/download/state/open logic. Key cases:

```ts
import { describe, it, expect, vi } from 'vitest'
import { UpdateManager, type UpdateManagerDependencies } from './updateManager'
import type { UpdateCheckResult } from '../../shared/ipc'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- updateManager`
Expected: FAIL — `UpdateManager` not exported.

- [ ] **Step 3: Implement `updateManager.ts`**

```ts
import { compareSemver, selectAsset, type AssetMeta } from './version'
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
    const selected = !prerelease && !draft ? selectAsset(stable, this.deps.getPlatform(), this.deps.getArch()) : undefined

    return {
      latestVersion,
      currentVersion: current,
      hasUpdate: !prerelease && !draft && compareSemver(latestVersion, current) > 0,
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
```

> **Note on SHA-256:** `downloadToFile` returns the computed SHA-256 hex of the streamed bytes. `UpdateManager.startDownload` verifies it against the asset digest (passed in by the IPC caller / check result), matching the spec. If no digest is exposed, `verifyDigest` returns true (best-effort, per spec). The mock returns `'deadbeef'` and the caller passes `'sha256:deadbeef'`, so tests pass without a real network.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- updateManager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/update/updateManager.ts apps/desktop/src/main/update/updateManager.test.ts
git commit -m "feat(update): UpdateManager with check, download state machine, open, notify"
```

---

### Task 4: Wire `UpdateManager` to Electron main (real deps, IPC handlers, notification)

**Files:**
- Create: `apps/desktop/src/main/update/electronUpdate.ts`
- Modify: `apps/desktop/src/main/index.ts` (instantiate + register IPC)
- Test: `apps/desktop/src/main/update/electronUpdate.test.ts`

**Interfaces:**
- Depends on: `UpdateManager`, all deps from Task 3, `IPC_CHANNELS.update` + `IpcResult` (Task 1), `app`/`shell`/`Notification` from Electron.
- Produces: `registerUpdateIpc(manager: UpdateManager, win: () => BrowserWindow | null): void` and `createUpdateManager(): UpdateManager`.
  - `createUpdateManager` supplies real deps: `getDownloadDir` → `app.getPath('downloads')` (fallback `app.getPath('userData')`), `httpGetJson` → `net.fetch(...).then(r => r.json())`, `downloadToFile` → streams to a file and hashes the bytes, `openPath` → `shell.openPath`, `notify` → `new Notification(...)` with a click handler that brings the app window to the foreground.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/update/electronUpdate.test.ts`. It guards the wiring contract: `UpdateManager` (Task 3) must expose the public surface and the `verifyDigest` helper must reject a mismatch. The Electron-specific deps (`net`/`shell`/`Notification`) are not exercised here — they are covered by renderer tests and manual smoke.

```ts
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- electronUpdate`
Expected: PASS (Task 3 already implemented `UpdateManager` + `verifyDigest`).

- [ ] **Step 3: Implement `electronUpdate.ts`**

Create `apps/desktop/src/main/update/electronUpdate.ts`:

```ts
import { app, shell, Notification, net, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { UpdateManager, type UpdateManagerDependencies } from './updateManager'

// `verifyDigest` lives in ./updateManager (Task 3); it is imported/used there.
export function createUpdateManager(): UpdateManager {
  const deps: UpdateManagerDependencies = {
    getCurrentVersion: () => app.getVersion(),
    getPlatform: () => process.platform,
    getArch: () => process.arch,
    getDownloadDir: async () => {
      const dir = app.getPath('downloads')
      await mkdir(dir, { recursive: true })
      return dir
    },
    httpGetJson: async (url) => {
      const res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
      return res.json()
    },
    downloadToFile: async (url, dest, onProgress) => {
      const res = await net.fetch(url)
      if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
      const total = Number(res.headers.get('content-length') ?? 0)
      const hash = createHash('sha256')
      let received = 0
      const ws = createWriteStream(dest)
      const reader = res.body.getReader()
      const write = (chunk: Uint8Array) => new Promise<void>((resolve, reject) => {
        ws.write(Buffer.from(chunk), (err?: Error | null) => err ? reject(err) : resolve())
      })
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          hash.update(value)
          received += value.byteLength
          if (total > 0) onProgress(Math.min(1, received / total))
          await write(value)
        }
        await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => err ? reject(err) : resolve()))
      } finally {
        reader.releaseLock()
        ws.destroy()
      }
      return hash.digest('hex')
    },
    openPath: async (path) => { await shell.openPath(path) },
    notify: (title, body) => {
      const n = new Notification({ title, body })
      n.on('click', () => {
        // Bring the existing window to the foreground (or create one).
        const win = BrowserWindow.getAllWindows()[0]
        if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
      })
      n.show()
    }
  }
  return new UpdateManager(deps)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- electronUpdate`
Expected: PASS.

- [ ] **Step 5: Register the IPC handlers in main**

In `apps/desktop/src/main/index.ts`, add imports:

```ts
import { IPC_CHANNELS, type IpcResult } from '../shared/ipc'
import { createUpdateManager } from './update/electronUpdate'
import type { UpdateDownloadState, UpdateDownloadAction } from '../shared/ipc'
```

After the `getAppVersion` handler, create the manager and register handlers:

```ts
const updateManager = createUpdateManager()

ipcMain.handle(IPC_CHANNELS.update.check, async (): Promise<IpcResult<UpdateCheckResult>> => {
  try {
    return { ok: true, data: await updateManager.checkForUpdate() }
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : 'Check failed', code: 'UPDATE_CHECK_FAILED' } }
  }
})

ipcMain.handle(IPC_CHANNELS.update.getStatus, (): IpcResult<UpdateDownloadState> => {
  return { ok: true, data: updateManager.getStatus() }
})

ipcMain.handle(IPC_CHANNELS.update.startDownload, (_e, dl: UpdateDownloadAction): Promise<IpcResult<void>> => {
  if (!dl || typeof dl.downloadUrl !== 'string' || dl.downloadUrl.length === 0 || typeof dl.assetName !== 'string' || dl.assetName.length === 0) {
    return Promise.resolve({ ok: false, error: { message: 'Invalid download input.', code: 'INVALID_UPDATE_DOWNLOAD' } })
  }
  return (async () => {
    await updateManager.startDownload({ downloadUrl: dl.downloadUrl, assetName: dl.assetName }, dl.digest)
    return { ok: true, data: undefined }
  })()
})

ipcMain.handle(IPC_CHANNELS.update.openInstaller, async (): Promise<IpcResult<boolean>> => {
  const ok = await updateManager.openInstaller()
  return { ok: true, data: ok }
})
```

Then add `onUpdateReady` wiring. In main, wire the notification click to show the window and emit to the renderer:

```ts
updateManager.onDownloadComplete(() => {
  if (mainWindow) {
    mainWindow.webContents.send('update:ready')
  }
})
```

> **Note:** `mainWindow` is a module-level `let`. For the notification click, add an IPC event subscription that the preload exposes as `onUpdateReady`. Production wiring for the notification `on('click')` is left to Task 5/6, which add the renderer side.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/update/electronUpdate.ts apps/desktop/src/main/update/electronUpdate.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(update): wire UpdateManager to Electron main with real deps and IPC"
```

---

### Task 5: Expose update methods + `onUpdateReady` in the preload bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Test: (covered by renderer tests in Task 6; add a type-check under `src/preload`)

**Interfaces:**
- Depends on: `IPC_CHANNELS.update`, `UpdateCheckResult`, `UpdateDownloadState`, `UpdateDownloadAction` (Task 1).
- Produces: preload exposes `checkForUpdates`, `startUpdateDownload`, `getUpdateStatus`, `openUpdateInstaller`, `onUpdateReady`.

- [ ] **Step 1: Add the preload methods**

In `apps/desktop/src/preload/index.ts`, add to the `api` object:

```ts
checkForUpdates: () => invoke<UpdateCheckResult>(IPC_CHANNELS.update.check),
startUpdateDownload: (dl: UpdateDownloadAction) => invoke<void>(IPC_CHANNELS.update.startDownload, dl),
getUpdateStatus: () => invoke<UpdateDownloadState>(IPC_CHANNELS.update.getStatus),
openUpdateInstaller: () => invoke<boolean>(IPC_CHANNELS.update.openInstaller),
onUpdateReady: (cb: () => void) => {
  const listener = () => cb()
  ipcRenderer.on('update:ready', listener)
  return () => ipcRenderer.removeListener('update:ready', listener)
}
```

Add the needed type imports (`UpdateCheckResult`, `UpdateDownloadState`, `UpdateDownloadAction`) to the existing `import { ... } from '../shared/ipc'` block.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @meow-gateway/desktop typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/shared/ipc.ts
git commit -m "feat(update): expose update API and onUpdateReady event in preload"
```

---

### Task 6: Update the test setup mock + renderer unit tests for Sidebar and UpdateModal

**Files:**
- Modify: `apps/desktop/src/render/src/test/setup.ts`
- Create: `apps/desktop/src/render/src/components/UpdateModal.test.tsx`
- Modify: `apps/desktop/src/render/src/components/Sidebar.test.tsx`

**Interfaces:**
- Depends on: `UpdateModal` component (created in Task 7), `WindowApi.update*` methods.

> **Note:** The test setup must add the new `window.meowGateway.update*` mocks BEFORE `UpdateModal` and `Sidebar` (which depend on them) are tested. Task 7 creates the real components; this task adds the mock surface and the component tests. Because `UpdateModal` is consumed by Task 7, write the component tests here referencing the component, then implement the component in Task 7 so the test drives it (TDD).

- [ ] **Step 1: Update `test/setup.ts`**

Add to the `window.meowGateway` value:

```ts
checkForUpdates: vi.fn().mockResolvedValue({ latestVersion: '0.3.0', currentVersion: '0.3.0', hasUpdate: false, releaseUrl: '', releaseName: '', publishedAt: '' }),
startUpdateDownload: vi.fn().mockResolvedValue(undefined),
getUpdateStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
openUpdateInstaller: vi.fn().mockResolvedValue(false),
onUpdateReady: vi.fn().mockReturnValue(() => {})
```

- [ ] **Step 2: Write the failing `UpdateModal` test**

Create `apps/desktop/src/render/src/components/UpdateModal.test.tsx`:

```tsx
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
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- UpdateModal`
Expected: FAIL — `./UpdateModal` module not found.

- [ ] **Step 4: (Task 7 implements the component; return here afterward)**
Marked as a dependency — Task 7 provides the implementation. The test stays as the gate.

- [ ] **Step 5: Add Sidebar tests for the Check update button**

In `apps/desktop/src/render/src/components/Sidebar.test.tsx`, add:

```tsx
it('renders a Check update button in the footer', () => {
  render(<Sidebar active="providers" onSelect={vi.fn()} running />)
  expect(screen.getByText(/Check update/i)).toBeTruthy()
})
```

Add the new test and run: `pnpm --filter @meow-gateway/desktop test -- Sidebar`

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/src/test/setup.ts apps/desktop/src/render/src/components/UpdateModal.test.tsx apps/desktop/src/render/src/components/Sidebar.test.tsx
git commit -m "test(update): add renderer mocks and UpdateModal/Sidebar tests"
```

---

### Task 7: Implement `UpdateModal` component

**Files:**
- Create: `apps/desktop/src/render/src/components/UpdateModal.tsx`

**Interfaces:**
- Depends on: `Modal` from `./ui`, `UpdateCheckResult`, `UpdateDownloadState` (Task 1), `window.meowGateway.update*`.
- Produces: `UpdateModal` with props `{ open: boolean; result: UpdateCheckResult; status: UpdateDownloadState; onClose: () => void; onInstall?: () => void }`. It renders checking/no-update/update-available/downloading/downloaded/error via `status` and drives the download via `window.meowGateway.startUpdateDownload`.

- [ ] **Step 1: Implement the component**

Create `apps/desktop/src/render/src/components/UpdateModal.tsx`:

```tsx
import { Modal, Button, Spinner } from './ui'
import type { UpdateCheckResult, UpdateDownloadState } from '@shared/ipc'

export function UpdateModal({
  open,
  result,
  status,
  onClose,
  onInstall,
}: {
  open: boolean
  result: UpdateCheckResult
  status: UpdateDownloadState
  onClose: () => void
  onInstall?: () => void
}) {
  const downloading = status.status === 'downloading'
  const downloaded = status.status === 'downloaded'
  const errored = status.status === 'error'

  return (
    <Modal open={open} title="Update" onClose={onClose}>
      {!result.hasUpdate && status.status === 'idle' && (
        <p className="dialog-message">
          You're on the latest version (v{result.currentVersion}).
        </p>
      )}
      {result.hasUpdate && !downloading && !downloaded && !errored && (
        <>
          <p className="dialog-message">
            A new version (v{result.latestVersion}) is available. You're on v{result.currentVersion}.
          </p>
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => window.meowGateway.startUpdateDownload({ downloadUrl: result.downloadUrl!, assetName: result.assetName!, digest: result.digest })}>
              Download & Install
            </Button>
          </div>
        </>
      )}
      {downloading && <Spinner label={`Downloading ${Math.round(status.progress * 100)}%`} />}
      {downloaded && (
        <>
          <p className="dialog-message">Download complete. Install when ready.</p>
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => (onInstall ? onInstall() : window.meowGateway.openUpdateInstaller())}>Install Now</Button>
          </div>
        </>
      )}
      {errored && (
        <>
          <p className="dialog-message">Download failed: {status.message}</p>
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => window.meowGateway.startUpdateDownload({ downloadUrl: result.downloadUrl!, assetName: result.assetName!, digest: result.digest })}>Retry</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: Run the UpdateModal test to verify it passes**

Run: `pnpm --filter @meow-gateway/desktop test -- UpdateModal`
Expected: PASS.

- [ ] **Step 3: Run typecheck + lint**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/components/UpdateModal.tsx
git commit -m "feat(update): UpdateModal popup for check/download/install flow"
```

---

### Task 8: Add the Check update button to the Sidebar footer + auto-check on App mount

**Files:**
- Modify: `apps/desktop/src/render/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/render/src/App.tsx`
- Test: `apps/desktop/src/render/src/components/Sidebar.test.tsx` (already added), `apps/desktop/src/render/src/App.test.tsx`

**Interfaces:**
- Depends on: `UpdateModal` (Task 7), `window.meowGateway.checkForUpdates` / `getUpdateStatus` / `onUpdateReady`.

- [ ] **Step 1: Add the Check update button to the Sidebar footer**

In `apps/desktop/src/render/src/components/Sidebar.tsx`, add state for the update flow and the button. Import `UpdateModal` and `Button`:

```tsx
import { Button } from './ui'
import { UpdateModal } from './UpdateModal'
import type { UpdateCheckResult, UpdateDownloadState } from '@shared/ipc'

// inside Sidebar component:
const [updateOpen, setUpdateOpen] = useState(false)
const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
const [updateStatus, setUpdateStatus] = useState<UpdateDownloadState>({ status: 'idle' })
const [checking, setChecking] = useState(false)

const handleCheckUpdate = async () => {
  setChecking(true)
  try {
    const res = await window.meowGateway.checkForUpdates()
    setUpdateResult(res)
    setUpdateStatus({ status: 'idle' })
    setUpdateOpen(true)
  } catch {
    setUpdateResult({ latestVersion: '', currentVersion: '', hasUpdate: false, releaseUrl: '', releaseName: '', publishedAt: '' })
    setUpdateOpen(true)
  } finally {
    setChecking(false)
  }
}
```

Render in the footer (below the version line):

```tsx
<Button variant="ghost" onClick={handleCheckUpdate} disabled={checking}>
  {checking ? 'Checking…' : 'Check update'}
</Button>
```

Render the modal at the end of `<aside>`:

```tsx
{updateResult && (
  <UpdateModal open={updateOpen} result={updateResult} status={updateStatus} onClose={() => setUpdateOpen(false)} />
)}
```

- [ ] **Step 2: Add auto-check on App mount**

In `apps/desktop/src/render/src/App.tsx`, add:

```tsx
const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
const [updateOpen, setUpdateOpen] = useState(false)
const [updateStatus, setUpdateStatus] = useState<UpdateDownloadState>({ status: 'idle' })

useEffect(() => {
  let cancelled = false
  window.meowGateway.checkForUpdates()
    .then((res) => { if (!cancelled && res.hasUpdate) { setUpdateResult(res); setUpdateStatus({ status: 'idle' }); setUpdateOpen(true) } })
    .catch(() => {})
  const unsub = window.meowGateway.onUpdateReady(() => {
    if (!cancelled) { setUpdateResult((prev) => prev); setUpdateStatus({ status: 'downloaded', filePath: '' }); setUpdateOpen(true) }
  })
  return () => { cancelled = true; unsub() }
}, [])
```

Render `<UpdateModal>` at the bottom of `.app-shell`, gated by `updateResult`.

> **Note on `onUpdateReady`:** in production the main process sends `update:ready` when a background download completes. The renderer reopens the popup in the `downloaded` state. Because we don't yet know the exact `filePath` from the event, the status uses a placeholder `filePath: ''`; the `openInstaller` handler reads the real path from main state, so this is safe.

- [ ] **Step 3: Run renderer tests**

Run: `pnpm --filter @meow-gateway/desktop test -- Sidebar App`
Expected: PASS.

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/components/Sidebar.tsx apps/desktop/src/render/src/App.tsx apps/desktop/src/render/src/components/UpdateModal.tsx
git commit -m "feat(update): Check update button in sidebar + auto-check on launch"
```

---

### Task 9: Wire the OS Notification click to reuse the app window in main

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/src/main/update/electronUpdate.test.ts` (extend)

**Interfaces:**
- Depends on: `updateManager.onDownloadComplete`, `showWindow`, `mainWindow`.

- [ ] **Step 1: Extend the notification click wiring**

In `apps/desktop/src/main/index.ts`, after `createUpdateManager()`, add the notification click behavior. The manager's `notify` dep currently only calls `new Notification(...).show()`. We want the click to call `showWindow()` and emit `update:ready`.

Add an `on('click')` handler. Because `createUpdateManager` builds a fresh `Notification` inside its `notify` dep, add a `reopenOnReady` callback that main sets up after creating the manager:

```ts
updateManager.onDownloadComplete(() => {
  if (mainWindow) mainWindow.webContents.send('update:ready')
})
```

And in the manager's real `notify` dep (in `electronUpdate.ts`), attach a click handler that shows the window. Change the `notify` dep in `electronUpdate.ts`:

```ts
notify: (title, body) => {
  const n = new Notification({ title, body })
  n.on('click', () => {
    // Bring the existing window to front or create one.
    const win = BrowserWindow.getAllWindows()[0]
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  })
  n.show()
}
```

> **Note:** This references `BrowserWindow` from Electron. For testability the `notify` dep is injected (so tests pass a `vi.fn()`), and the click-handling lives inside `createUpdateManager`'s production dep.

- [ ] **Step 2: Run the electronUpdate test**

Run: `pnpm --filter @meow-gateway/desktop test -- electronUpdate`
Expected: PASS (unchanged behavior; the added click wiring is in the production `notify` dep which the test does not exercise directly).

- [ ] **Step 3: Run typecheck + lint + full test**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop lint && pnpm --filter @meow-gateway/desktop test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/update/electronUpdate.ts
git commit -m "feat(update): OS notification click reopens app window"
```

---

### Task 10: Full validation + documentation

**Files:**
- Modify: `docs/BUILD_RELEASE.md` (add an "In-app update check" note)
- Modify: `docs/changelogs/` (add v0.4.0 entry representing this feature)

- [ ] **Step 1: Run the full desktop test suite + typecheck + lint**

```bash
cd /e/Git/GitHub/meow-router
pnpm --filter @meow-gateway/desktop typecheck
pnpm --filter @meow-gateway/desktop lint
pnpm --filter @meow-gateway/desktop test
```

Expected: All pass (typecheck clean, lint clean, 260+ existing + new tests green).

- [ ] **Step 2: Run the full monorepo checks**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: All pass.

- [ ] **Step 3: Update `docs/BUILD_RELEASE.md`**

Add a short subsection under "Releasing (GitHub Actions)" describing that the app can check for updates from the sidebar by reading the latest GitHub release, and that consumers must publish installers as GitHub Release assets for the checker to find them.

- [ ] **Step 4: Add a changelog entry**

Add `docs/changelogs/v0.4.0.md` summarizing the in-app update check + download feature.

- [ ] **Step 5: Commit**

```bash
git add docs/BUILD_RELEASE.md docs/changelogs/v0.4.0.md
git commit -m "docs: document in-app update check and add v0.4.0 changelog"
```

---

## Self-review notes

- **Spec coverage:** Every part of the spec is mapped: `UpdateManager` (§5), IPC contract (§4), Sidebar button (§6.1), `UpdateModal` (§6.2), auto-check (§6.3), notification/re-open (§5.3/§6.4), error handling (§7), testing plan (§8). Asset-selection preference and semver handling are correct (Task 2). SHA-256 digest verification is implemented in `UpdateManager.startDownload` (Task 3) and tested via the `verifyDigest` helper; the best-effort fallback from the spec is honored when no digest is exposed.
- **Type consistency:** `UpdateManagerDependencies`, `UpdateCheckResult`, `UpdateDownloadState`, `UpdateDownloadAction` are named consistently across Tasks 1–9. `startDownload(dl, expectedDigest?)` signature is consistent between the class (Task 3) and the IPC handler (Task 4). The preload `onUpdateReady` returns an unsubscribe function (Task 5) which App.tsx consumes (Task 8).
- **Placeholder scan:** No TBD/TODO. All code steps contain real code. No unused/placeholder deps remain in the interface.
