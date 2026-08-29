import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type PingPayload, type PingResult } from '../shared/ipc'
import { bootstrapMeowGatewayApp, type MeowGatewayApp } from './app/bootstrap'

let meowApp: MeowGatewayApp | undefined

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../render/index.html'))
  }
  return win
}

app.whenReady().then(async () => {
  ipcMain.handle(IPC_CHANNELS.ping, (_e, payload: PingPayload): PingResult => {
    return { pong: 'pong', echo: payload.from }
  })

  // Boot the gateway app (DB, credentials, registry, gateway server, IPC).
  try {
    meowApp = await bootstrapMeowGatewayApp()
    const addr = await meowApp.start()
    console.info(`[gateway] listening on http://${addr.host}:${addr.port}`)
  } catch (err) {
    console.error('[gateway] failed to start', err)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  if (meowApp) {
    await meowApp.stop().catch(() => {})
    meowApp = undefined
  }
})
