// Credential store abstractions for the main process.
//
// Credentials are stored through the OS secure credential store (Electron
// safeStorage on supported platforms). They are NEVER:
// - sent to the renderer (main-process only),
// - stored in SQLite,
// - written to logs.
//
// The store is injected at the process boundary so tests use a mock backend and
// the real implementation only ever runs in the main process.

export interface CredentialStore {
  set(ref: string, secret: string): Promise<void>
  get(ref: string): Promise<string | null>
  delete(ref: string): Promise<void>
  has(ref: string): Promise<boolean>
}

// A credential reference (opaque id that maps to a stored secret). This is the
// only thing persisted in the database via `account.credential_ref`.
export type CredentialRef = string

// Safe, user-facing error codes. Never include raw secret material.
export type CredentialErrorCode =
  | 'NOT_AVAILABLE' // OS secure storage unavailable (e.g. no keyring on Linux)
  | 'NOT_FOUND'
  | 'INVALID_REF'
  | 'IO_ERROR' // underlying storage read/write failure
  | 'PROTECTED'

export class CredentialError extends Error {
  constructor(readonly code: CredentialErrorCode, message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

// Map any thrown error to a safe user-facing message. Never leaks the secret.
export function toSafeCredentialError(err: unknown): CredentialError {
  if (err instanceof CredentialError) return err
  return new CredentialError('IO_ERROR', 'Unable to access secure credential storage.')
}
