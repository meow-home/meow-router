// Credential store backed by Electron's safeStorage (OS keychain/credential vault).
//
// This is main-process only. Both the `safeStorage`-shaped backend and the
// encrypted-bytes persistence are injected so tests use fakes and we avoid
// importing `electron` at module load in non-Electron contexts. Production
// wiring in `src/main/index.ts` passes the real Electron safeStorage and a
// file-backed persistence under app-data (never SQLite, never plaintext).

import { CredentialError, toSafeCredentialError, type CredentialStore } from './types'

// Minimal shape of Electron's safeStorage that we depend on.
export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Uint8Array
  decryptString(encrypted: Uint8Array): string
}

// Where encrypted bytes are persisted (disk under app-data, not SQLite, never
// plaintext). Injected to keep this store independent of fs specifics.
export interface CredentialPersistence {
  set(ref: string, value: Uint8Array): Promise<void>
  get(ref: string): Promise<Uint8Array | null>
  delete(ref: string): Promise<void>
  has(ref: string): Promise<boolean>
}

// Valid credential refs must be non-empty and not contain control/whitespace
// characters. Keeps refs usable as secure-store keys and prevents abuse.
const INVALID_REF_RE = /[^\w.:/-]/

export class SafeStorageCredentialStore implements CredentialStore {
  constructor(
    private readonly backend: SafeStorageBackend,
    private readonly persistence: CredentialPersistence
  ) {}

  private requireAvailable(): void {
    if (!this.backend.isEncryptionAvailable()) {
      throw new CredentialError(
        'NOT_AVAILABLE',
        'Secure credential storage is not available on this system.'
      )
    }
  }

  private requireValidRef(ref: string): void {
    if (!ref || INVALID_REF_RE.test(ref)) {
      throw new CredentialError('INVALID_REF', 'Invalid credential reference.')
    }
  }

  async set(ref: string, secret: string): Promise<void> {
    try {
      this.requireValidRef(ref)
      this.requireAvailable()
      const encrypted = this.backend.encryptString(secret)
      await this.persistence.set(ref, new Uint8Array(encrypted))
    } catch (err) {
      throw this.remap(err)
    }
  }

  async get(ref: string): Promise<string | null> {
    try {
      this.requireValidRef(ref)
      this.requireAvailable()
      const encrypted = await this.persistence.get(ref)
      if (!encrypted) return null
      return this.backend.decryptString(encrypted)
    } catch (err) {
      throw this.remap(err)
    }
  }

  async delete(ref: string): Promise<void> {
    try {
      this.requireValidRef(ref)
      if (!this.backend.isEncryptionAvailable()) return
      await this.persistence.delete(ref)
    } catch (err) {
      throw this.remap(err)
    }
  }

  async has(ref: string): Promise<boolean> {
    try {
      this.requireValidRef(ref)
      return await this.persistence.has(ref)
    } catch (err) {
      throw this.remap(err)
    }
  }

  private remap(err: unknown): CredentialError {
    return toSafeCredentialError(err)
  }
}
