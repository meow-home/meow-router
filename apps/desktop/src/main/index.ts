import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS, type PingPayload, type PingResult } from '../shared/ipc'

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

app.whenReady().then(() => {
  ipcMain.handle(IPC_CHANNELS.ping, (_e, payload: PingPayload): PingResult => {
    return { pong: 'pong', echo: payload.from }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
