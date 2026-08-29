// Production wiring for the credential service (main process only).
//
// Imports Electron's `safeStorage` and a file-backed encrypted-bytes
// persistence under the app data dir. This module must only ever be imported
// from the Electron main process, never from the renderer or tests.

import { safeStorage, app } from 'electron'
import { join } from 'node:path'
import { SafeStorageCredentialStore } from './safeStorageStore'
import { FileCredentialPersistence } from './filePersistence'
import { DefaultCredentialService, type CredentialService } from './credentialService'

export function createCredentialService(): CredentialService {
  const dir = join(app.getPath('userData'), 'credentials')
  const persistence = new FileCredentialPersistence(dir)
  const store = new SafeStorageCredentialStore(safeStorage, persistence)
  return new DefaultCredentialService(store)
}
