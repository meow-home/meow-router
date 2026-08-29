// High-level credential service exposing the task's T103 API.
//
// This is the only surface other main-process modules (and the IPC layer) talk
// to. It validates every ref, never echoes secrets, and maps any underlying
// failure to a safe error. Renderer NEVER receives credentials through this API.

import { CredentialError, toSafeCredentialError, type CredentialStore } from './types'

export interface CredentialService {
  setCredential(ref: string, secret: string): Promise<void>
  getCredential(ref: string): Promise<string | null>
  deleteCredential(ref: string): Promise<void>
  hasCredential(ref: string): Promise<boolean>
}

// Refs are opaque but require safe characters so they can be used as keys.
const VALID_REF_RE = /^[\w.:/-]+$/

function assertValidRef(ref: unknown): asserts ref is string {
  if (typeof ref !== 'string' || !VALID_REF_RE.test(ref)) {
    throw new CredentialError('INVALID_REF', 'Invalid credential reference.')
  }
}

function assertSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new CredentialError('INVALID_REF', 'Invalid credential value.')
  }
}

export class DefaultCredentialService implements CredentialService {
  // The underlying store is injected at the process boundary so tests use a
  // mock and the main process uses the safeStorage-backed store.
  constructor(private readonly store: CredentialStore) {}

  async setCredential(ref: string, secret: string): Promise<void> {
    try {
      assertValidRef(ref)
      assertSecret(secret)
      await this.store.set(ref, secret)
    } catch (err) {
      throw this.remap(err)
    }
  }

  async getCredential(ref: string): Promise<string | null> {
    try {
      assertValidRef(ref)
      return await this.store.get(ref)
    } catch (err) {
      throw this.remap(err)
    }
  }

  async deleteCredential(ref: string): Promise<void> {
    try {
      assertValidRef(ref)
      await this.store.delete(ref)
    } catch (err) {
      throw this.remap(err)
    }
  }

  async hasCredential(ref: string): Promise<boolean> {
    try {
      assertValidRef(ref)
      return await this.store.has(ref)
    } catch (err) {
      throw this.remap(err)
    }
  }

  private remap(err: unknown): CredentialError {
    return toSafeCredentialError(err)
  }
}
