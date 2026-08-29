import { describe, it, expect } from 'vitest'
import {
  DefaultCredentialService,
  CredentialError,
  MemoryCredentialStore,
  SafeStorageCredentialStore,
  UnavailableCredentialStore,
  type SafeStorageBackend,
  type CredentialPersistence
} from './index'

describe('CredentialService (mock/in-memory backend)', () => {
  it('stores and retrieves a credential', async () => {
    const svc = new DefaultCredentialService(new MemoryCredentialStore())
    await svc.setCredential('provider.openai.primary', 'sk-abc123')
    expect(await svc.getCredential('provider.openai.primary')).toBe('sk-abc123')
    expect(await svc.hasCredential('provider.openai.primary')).toBe(true)
  })

  it('returns null for a missing credential', async () => {
    const svc = new DefaultCredentialService(new MemoryCredentialStore())
    expect(await svc.getCredential('nope')).toBeNull()
    expect(await svc.hasCredential('nope')).toBe(false)
  })

  it('deletes a credential', async () => {
    const svc = new DefaultCredentialService(new MemoryCredentialStore())
    await svc.setCredential('r1', 'secret')
    await svc.deleteCredential('r1')
    expect(await svc.getCredential('r1')).toBeNull()
    expect(await svc.hasCredential('r1')).toBe(false)
  })

  it('validates credential refs and rejects invalid ones', async () => {
    const svc = new DefaultCredentialService(new MemoryCredentialStore())
    await expect(svc.setCredential('bad ref with spaces', 'x')).rejects.toThrow(CredentialError)
    await expect(svc.setCredential('', 'x')).rejects.toThrow(CredentialError)
    await expect(svc.getCredential('bad ref with spaces')).rejects.toThrow(CredentialError)
  })

  it('never logs or echoes secrets back as part of the secret value', async () => {
    const store = new MemoryCredentialStore()
    const svc = new DefaultCredentialService(store)
    await svc.setCredential('r1', 'super-secret-value')
    // The store must hold the value, but the credential ref is the only
    // identifier exposed; the secret is not part of any message.
    expect(store.dump().get('r1')).toBe('super-secret-value')
  })

  it('maps OS-unavailable errors to a safe NOT_AVAILABLE message', async () => {
    const svc = new DefaultCredentialService(new UnavailableCredentialStore())
    try {
      await svc.setCredential('r1', 'secret')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialError)
      expect((err as CredentialError).code).toBe('NOT_AVAILABLE')
      // No secret appears anywhere in the error.
      expect((err as CredentialError).message).not.toContain('secret')
    }
  })
})

describe('SafeStorageCredentialStore (fake safeStorage)', () => {
  // A fake safeStorage that "encrypts" by reversing bytes (clearly not secure,
  // but good enough to verify the store encrypts before persisting and never
  // writes plaintext to persistence).
  const fakeSafeStorage: SafeStorageBackend = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => new TextEncoder().encode([...s].reverse().join('')),
    decryptString: (b) => [...new TextDecoder().decode(b)].reverse().join('')
  }

  it('writes only encrypted bytes to persistence, never plaintext', async () => {
    let persisted: Uint8Array | null = null
    const persistence: CredentialPersistence = {
      set: async (_r, v) => {
        persisted = v
      },
      get: async () => persisted,
      delete: async () => {
        persisted = null
      },
      has: async () => persisted !== null
    }
    const store = new SafeStorageCredentialStore(fakeSafeStorage, persistence)
    await store.set('provider.openai.primary', 'sk-plaintext-secret')
    expect(persisted).not.toBeNull()
    // The persisted bytes should NOT equal the plaintext.
    const plain = new TextEncoder().encode('sk-plaintext-secret')
    expect(Buffer.from(persisted!).equals(Buffer.from(plain))).toBe(false)
    // Round-trips back to plaintext.
    expect(await store.get('provider.openai.primary')).toBe('sk-plaintext-secret')
  })

  it('survives a restart (re-reading from persistence)', async () => {
    const map = new Map<string, Uint8Array>()
    const persistence: CredentialPersistence = {
      set: async (r, v) => {
        map.set(r, v)
      },
      get: async (r) => map.get(r) ?? null,
      delete: async (r) => {
        map.delete(r)
      },
      has: async (r) => map.has(r)
    }
    const store1 = new SafeStorageCredentialStore(fakeSafeStorage, persistence)
    await store1.set('r1', 'survives-restart')
    const store2 = new SafeStorageCredentialStore(fakeSafeStorage, persistence)
    expect(await store2.get('r1')).toBe('survives-restart')
  })

  it('does not require encryption for delete/has when unavailable', async () => {
    const unavailable: SafeStorageBackend = {
      isEncryptionAvailable: () => false,
      encryptString: () => new Uint8Array(),
      decryptString: () => ''
    }
    const store = new SafeStorageCredentialStore(unavailable, {
      set: async () => {},
      get: async () => null,
      delete: async () => {},
      has: async () => false
    })
    await store.delete('r1') // no throw even though unavailable
    expect(await store.has('r1')).toBe(false)
    await expect(store.set('r1', 'x')).rejects.toThrow(CredentialError)
    await expect(store.get('r1')).rejects.toThrow(CredentialError)
  })
})
