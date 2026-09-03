// Single-instance guard for the Electron main process.
//
// Meow Gateway is a background service: it owns a loopback HTTP gateway and a
// system tray that keeps serving while the window is hidden. If the user
// double-clicks the app icon (or otherwise launches a second copy) while one is
// already running, naively starting that second process would:
//
//   - spawn a new main process with its own window and tray icon; and
//   - fail to bind the loopback gateway port (already in use).
//
// `requestSingleInstanceLock` is Electron's cross-process mutex. Only the first
// process gets a lock; any later process gets `false` and must quit. When the
// second launch happens, the *primary* instance receives a `second-instance`
// event and should re-focus its window, so the user lands on the running app
// rather than a dead duplicate.

import { app } from 'electron'

export interface SingleInstanceCallbacks {
  /** Called on the primary instance when a second copy is launched. */
  onSecondInstance: () => void
}

/**
 * Attempt to become the single running instance.
 *
 * @returns `true` if this process holds the lock (it should continue to boot
 * the app). `false` if another instance already holds it — the caller MUST quit
 * immediately and must NOT create a window, tray, or gateway.
 */
export function acquireSingleInstanceLock(cb: SingleInstanceCallbacks): boolean {
  if (!app.requestSingleInstanceLock()) {
    // Another instance is already running; this process must not boot a second
    // copy. Quit right away, before any window/tray/gateway is created.
    app.quit()
    return false
  }

  // We are the primary instance. When the user launches another copy, focus the
  // existing window instead of spawning a duplicate.
  app.on('second-instance', () => {
    cb.onSecondInstance()
  })

  return true
}
