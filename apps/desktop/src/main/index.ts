import { app, BrowserWindow, ipcMain, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type IpcResult, type PingPayload, type PingResult } from '../shared/ipc'
import { bootstrapMeowGatewayApp, type MeowGatewayApp } from './app/bootstrap'
import { createTray, destroyTray, hasTray } from './tray'

let meowApp: MeowGatewayApp | undefined
let mainWindow: BrowserWindow | null = null
// Set to true only from a real quit path (tray "Quit" or app menu), so that the
// window 'close' handler knows whether to hide to the tray or actually exit.
let isQuitting = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#0b0e14',
    // The window icon is the render public asset (public/logo.png -> out/render/logo.png),
    // reachable from the bundled main process at ../render/logo.png.
    icon: nativeImage.createFromPath(join(__dirname, '../render/logo.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // When a tray is present, closing the window hides it to the tray so the
  // gateway keeps serving. Without a tray (e.g. no appindicator on Linux) the
  // default close behaviour applies (see 'window-all-closed').
  win.on('close', (event) => {
    if (!isQuitting && hasTray()) {
      event.preventDefault()
      win.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../render/index.html'))
  }
  return win
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideWindow(): void {
  mainWindow?.hide()
}

app.whenReady().then(async () => {
  ipcMain.handle(IPC_CHANNELS.ping, (_e, payload: PingPayload): PingResult => {
    return { pong: 'pong', echo: payload.from }
  })

  // NOTE: this MUST return an IpcResult envelope ({ ok, data }) matching what
  // the preload `invoke<T>()` helper unwraps. If we return the raw version
  // string, `result.ok` is undefined -> falsy -> the preload throws and the
  // Sidebar falls back to its placeholder, so the footer never shows the real
  // (bumped) version.
  ipcMain.handle(IPC_CHANNELS.getAppVersion, (): IpcResult<string> => {
    return { ok: true, data: app.getVersion() }
  })

  // Remove the native File/Edit/View... menu bar; the app is a self-contained
  // workspace with its own in-app navigation.
  Menu.setApplicationMenu(null)

  // Boot the gateway app (DB, credentials, registry, gateway server, IPC).
  try {
    meowApp = await bootstrapMeowGatewayApp()
    const addr = await meowApp.start()
    console.info(`[gateway] listening on http://${addr.host}:${addr.port}`)
  } catch (err) {
    console.error('[gateway] failed to start', err)
  }

  mainWindow = createWindow()

  // Add the app to the system tray so it keeps running (and serving) when the
  // window is closed. If the platform has no tray, this is a no-op.
  createTray({
    showWindow,
    hideWindow,
    quit: () => {
      isQuitting = true
      app.quit()
    },
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  // The app keeps running in the tray (where the gateway keeps serving). We only
  // quit for real from the tray "Quit" item. On macOS the convention is to keep
  // the app alive in the dock anyway.
  if (!hasTray() && process.platform !== 'darwin') app.quit()
})

// Electron does not await async 'before-quit' handlers, so we prevent the first
// quit, stop the gateway, then re-invoke quit once it is clean.
app.on('before-quit', (event) => {
  isQuitting = true
  if (meowApp) {
    event.preventDefault()
    const meow = meowApp
    meow
      .stop()
      .catch(() => {})
      .finally(() => {
        meowApp = undefined
        destroyTray()
        app.quit()
      })
  } else {
    destroyTray()
  }
})
