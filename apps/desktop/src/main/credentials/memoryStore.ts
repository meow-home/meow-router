// In-memory credential store. Used as a mock backend in unit tests and as a
// harmless fallback for development. Never persist secrets in real use.

import { CredentialError, type CredentialStore } from './types'

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>()

  async set(ref: string, secret: string): Promise<void> {
    this.values.set(ref, secret)
  }

  async get(ref: string): Promise<string | null> {
    return this.values.get(ref) ?? null
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref)
  }

  async has(ref: string): Promise<boolean> {
    return this.values.has(ref)
  }

  // For tests that want to assert that a secret was never stored in plaintext.
  dump(): Map<string, string> {
    return new Map(this.values)
  }
}

export class UnavailableCredentialStore implements CredentialStore {
  async set(_ref: string, _secret: string): Promise<void> {
    throw new CredentialError('NOT_AVAILABLE', 'Secure credential storage is not available.')
  }
  async get(_ref: string): Promise<string | null> {
    throw new CredentialError('NOT_AVAILABLE', 'Secure credential storage is not available.')
  }
  async delete(_ref: string): Promise<void> {
    throw new CredentialError('NOT_AVAILABLE', 'Secure credential storage is not available.')
  }
  async has(_ref: string): Promise<boolean> {
    throw new CredentialError('NOT_AVAILABLE', 'Secure credential storage is not available.')
  }
}
