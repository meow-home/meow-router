import { Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'

/**
 * Owns the system-tray lifecycle for the gateway.
 *
 * The app is a headless-ish background service: the gateway keeps serving while
 * the main window is hidden. Closing the window hides it to the tray rather than
 * quitting, so a coding agent's traffic is never interrupted.
 *
 * Tray icon is the render public asset (public/tray.png -> out/render/tray.png),
 * reachable from the bundled main process at ../render/tray.png.
 */

let tray: Tray | null = null

export interface TrayCallbacks {
  /** Show the main window; create it if it was closed. */
  showWindow: () => void
  /** Hide the main window. */
  hideWindow: () => void
  /** Quit the app for real (stops the gateway and exits). */
  quit: () => void
}

export function createTray(cb: TrayCallbacks): Tray | null {
  if (tray) return tray

  try {
    const icon = nativeImage.createFromPath(join(__dirname, '../render/tray.png'))
    tray = new Tray(icon)
    tray.setToolTip('Meow Gateway')

    const menu = Menu.buildFromTemplate([
      { label: 'Show Meow Gateway', click: () => cb.showWindow() },
      { label: 'Hide to Tray', click: () => cb.hideWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => cb.quit() },
    ])
    tray.setContextMenu(menu)

    // Clicking the tray icon on Windows/macOS toggles the window; on Linux the
    // context menu is the only interaction, so this is harmless there.
    tray.on('click', () => cb.showWindow())
    tray.on('double-click', () => cb.showWindow())

    return tray
  } catch {
    // Some Linux desktop environments have no tray support (no appindicator).
    // The app must still work: it falls back to normal close behaviour.
    tray = null
    return null
  }
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** True when a system tray icon is present, i.e. close means hide, not quit. */
export function hasTray(): boolean {
  return tray !== null
}
