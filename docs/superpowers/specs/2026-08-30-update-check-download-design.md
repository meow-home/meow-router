# Update Check & Download — Design

## 1. Problem

Meow Gateway is distributed as installers (NSIS `.exe` on Windows, `.dmg` on
macOS, `.AppImage`/`.deb` on Linux) published through GitHub Releases tagged
`v*`. Users currently have no way to discover a newer version from inside the
app.

We want to let the user:

- click a **Check update** button in the sidebar footer;
- see a popup telling them whether a newer version exists;
- if a newer version exists, download the installer for the current platform and
  open it to install;
- if they are already current, be told so;
- be checked automatically once when the app starts, with a popup if an update
  is available;
- if they close the popup while a download is running, the download continues in
  the background and they are notified via an OS notification on completion.

## 2. Decisions (confirmed with user)

- **Mechanism:** download the installer and open it (open the downloaded file).
  This is NOT silent auto-update. No code-signing is required, and the release
  workflow does not change.
- **Auto-check on launch:** run once; if an update exists, show the popup.
- **Background download:** closing the popup does not cancel the download. It
  continues; on completion an OS notification fires.
- **Notification click:** brings the app window to the foreground and reopens the
  update popup in the "downloaded" state.
- **Scope:** only stable releases (no pre-releases/drafts), tag form `v*`, from
  `github.com/meow-home/meow-router`.
- **Integrity:** verify the downloaded file's SHA-256 digest against the GitHub
  asset digest before opening it.

## 3. Architecture

```
Render (React)              Main Process                        GitHub
──────────────              ────────────                        ────
Sidebar footer
 [Check update] ─ IPC checkForUpdates ─▶ UpdateManager.checkForUpdate() ─ GET ─▶ /releases/latest
      │                               │  (semver compare, select OS asset)
      ▼                               ▼
 UpdateModal                    UpdateManager.download()
 [Download & Install] ─ IPC startUpdateDownload ─▶ net download + SHA-256    ─ GET ─▶ installer
      │                               │  (progress + state)
      │ ◀─ getUpdateStatus (poll) ────┤
      ▼                               ▼
 [Install Now] ─ IPC openUpdateInstaller ─▶ shell.openPath(file)
                                          + new Notification('downloaded')
```

### Separation of concerns (per AGENTS.md)

- All privileged operations live in the **main process**:
  - network requests (check + download) via Electron `net`;
  - filesystem writes;
  - SHA-256 verification;
  - OS notifications;
  - opening the installer via `shell.openPath`.
- The **renderer** only:
  - calls IPC and renders state;
  - never touches the filesystem, network, or OS APIs;
  - receives only non-sensitive payloads (versions, URLs, progress).

## 4. IPC contract & data types

New channels under `update`:

```ts
update: {
  check: 'update:check',
  getStatus: 'update:get-status',
  startDownload: 'update:start-download',
  openInstaller: 'update:open-installer'
}
```

New types:

```ts
export interface UpdateCheckResult {
  latestVersion: string      // e.g. "0.4.0"
  currentVersion: string     // e.g. "0.3.0" (app.getVersion())
  hasUpdate: boolean         // latestVersion > currentVersion (semver)
  releaseUrl: string         // URL to the GitHub release page
  releaseName: string        // e.g. "v0.4.0"
  publishedAt: string        // ISO timestamp
  downloadUrl?: string       // URL of the installer for the current platform
  assetName?: string         // e.g. "Meow_gateway_0.4.0_x64.exe"
}

export type UpdateDownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number }   // 0..1
  | { status: 'downloaded'; filePath: string }
  | { status: 'error'; message: string }

export type UpdateDownloadAction = {
  downloadUrl: string
  assetName: string
}
```

`WindowApi` additions:

```ts
checkForUpdates(): Promise<UpdateCheckResult>
startUpdateDownload(dl: UpdateDownloadAction): Promise<void>
getUpdateStatus(): Promise<UpdateDownloadState>
openUpdateInstaller(): Promise<boolean>
onUpdateReady(cb: () => void): () => void   // IPC event subscription (preload)
```

## 5. Main-process: UpdateManager

New module: `apps/desktop/src/main/update/updateManager.ts`.

```ts
interface UpdateManagerDependencies {
  getCurrentVersion: () => string      // app.getVersion()
  getPlatform: () => string            // process.platform
  getArch: () => string                // process.arch
}

class UpdateManager {
  constructor(deps: UpdateManagerDependencies)

  async checkForUpdate(): Promise<UpdateCheckResult>
  async startDownload(dl: UpdateDownloadAction): Promise<void>
  getStatus(): UpdateDownloadState
  async openInstaller(): Promise<boolean>
  onDownloadComplete(cb: () => void): void   // for Notification wiring
}
```

### 5.1 checkForUpdate

1. `GET https://api.github.com/repos/meow-home/meow-router/releases/latest`
   - returns the latest stable (non-prerelease, non-draft) release for the `v*`
     tag pattern.
2. Parse `tag_name`: strip leading `v`, compare with `currentVersion` using a
   semver comparator (`0.10.0 > 0.9.0`).
3. If `latestVersion > currentVersion`, `hasUpdate = true`. Select the matching
   asset for the current platform/arch. Preference order within a platform:
   - win32 → `.exe` (NSIS installer)
   - darwin → `.dmg`
   - linux → `.AppImage` (preferred: single executable, no root needed) then `.deb`
4. If no asset matches the platform, set `hasUpdate` still true but `downloadUrl`
   undefined; the UI shows "no installer for your platform" and only links to the
   release page.
5. If `latestVersion <= currentVersion`, `hasUpdate = false`.

Errors are mapped to actionable messages (see §7).

### 5.2 startDownload

1. Uses Electron `net.fetch`/`net.request` (never a system `curl`).
2. Streams to a temp/`downloads` path under `app.getPath('downloads')`.
3. Tracks byte progress from `content-length` → `progress` in `[0,1]`.
4. On stream end, hashes the file with SHA-256 and compares against the GitHub
   asset `digest` (`sha256:<hex>`).
5. If the digest matches → state `downloaded`. If not → state `error` (installer
   is NOT opened).
6. Fires `onDownloadComplete` listeners (used to show the OS notification).

> **Note:** the GitHub asset `digest` (`sha256:<hex>`) is only returned for
> assets uploaded through the GitHub API/CLI and present on newer releases. If
> the release exposes no `digest`, the manager falls back to verifying against
> a SHA-256 checksum it records from the release body, or, if none is available,
> it logs a warning and proceeds (opening the installer) rather than blocking the
> update. Integrity verification is best-effort: it is not a substitute for code
> signing, which is out of scope.

### 5.3 Notification & click

Main process creates an Electron `Notification` when a background download
completes. On click:

- `showWindow()` (bring the app to the foreground / reopen from tray);
- emit an `update:ready` event to the renderer so it reopens the update popup in
  the `downloaded` state.

### 5.4 openInstaller

`shell.openPath(downloadedFile)` — only allowed when state is `downloaded`.

## 6. Renderer UI

### 6.1 Sidebar footer button

A small `Button` (variant `ghost`) in `.rail__footer` near the version line:

```
[● Check update]
```

- Click → disable + `Spinner` → `checkForUpdates()`.
- States:
  - idle → "Check update"
  - has update available → a dot badge
  - downloading in background → show progress (e.g. "Downloading 42%")

### 6.2 UpdateModal (new component)

`apps/desktop/src/render/src/components/UpdateModal.tsx`, using the existing
`Modal` primitive.

Renders depending on state:

- `checking` → spinner "Checking for updates…"
- `no-update` → "You're on the latest version (v0.3.0)" + Close
- `update-available` → current → latest, release name, **Download & Install**
- `downloading` → progress bar (poll `getUpdateStatus`)
- `downloaded` → "Download complete. Install when ready." + **Install Now**
- `error` → message + Retry

The modal can be closed at any time (✕). Closing while `downloading` does **not**
cancel the download.

### 6.3 Auto-check on launch

`App.tsx` runs `checkForUpdates()` once on mount via `useEffect`. If `hasUpdate`,
it opens the `UpdateModal`.

### 6.4 Notification / re-open handling

Renderer subscribes to `onUpdateReady`. When the main process emits it, the
renderer opens the `UpdateModal` in the `downloaded` state.

## 7. Error handling

| Case | Message | Action |
|---|---|---|
| Network / GitHub unreachable | "Couldn't check for updates. Check your internet connection and try again." | Retry |
| No release found (no `v*` tag) | "No release found yet." | Close |
| GitHub API rate limit | "Rate limited by GitHub. Try again later." | Retry |
| No asset for current platform | "No installer for your platform (win32/x64) in this release." | Close (link to release page) |
| SHA-256 mismatch | "Download failed verification (checksum mismatch). The installer was not opened." | Retry download |
| Other download error | state `error` | Retry |

All errors answer: what happened, why, what to do (per UX_SPEC). No raw stack
traces are shown to the user.

## 8. Testing plan

### Unit — `updateManager.test.ts`
- semver compare (incl. `0.10.0 > 0.9.0`)
- asset selection per platform/arch (win/darwin/linux × x64/arm64)
- pre-release/draft filtering
- SHA-256 digest verification (match and mismatch)
- state machine transitions `idle → downloading → downloaded/error`

### IPC — `updateIpc.test.ts`
- handlers return the correct `IpcResult` envelope
- `startDownload` rejects invalid payloads (bad/missing `downloadUrl`, empty
  `assetName`)

### Renderer
- `Sidebar.test.tsx`: Check update button renders; click disables + spinner
- `UpdateModal.test.tsx`: renders checking / no-update / update-available /
  downloaded / error; Download & Install calls `startUpdateDownload`; closing
  while downloading does not cancel

### Manual smoke (needs a real GitHub release)
- Check update from the sidebar button
- Auto-check on launch
- Real download + SHA-256 verification
- Background download + OS notification + click reopens popup

## 9. Out of scope

- Silent auto-update / electron-updater.
- Code signing / notarization.
- Delta / differential updates.
- Pre-release / beta channel.
- Multi-channel (stable / beta) toggle.
