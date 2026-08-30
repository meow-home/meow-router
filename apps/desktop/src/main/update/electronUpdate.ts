import { app, shell, Notification, net, BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
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
