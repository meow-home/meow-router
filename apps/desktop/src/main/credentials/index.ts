// Public exports for the credential layer. `production.ts` is intentionally NOT
// re-exported here because it imports Electron (main-process-only).

export { CredentialError, toSafeCredentialError } from './types'
export type { CredentialStore, CredentialErrorCode } from './types'
export { DefaultCredentialService } from './credentialService'
export type { CredentialService } from './credentialService'
export { SafeStorageCredentialStore } from './safeStorageStore'
export type { SafeStorageBackend, CredentialPersistence } from './safeStorageStore'
export { FileCredentialPersistence } from './filePersistence'
export { MemoryCredentialStore, UnavailableCredentialStore } from './memoryStore'
