// Local gateway key: generation, masking and credential-store access.
//
// The key authenticates clients against THIS gateway. It is unrelated to
// provider credentials and is never written to SQLite.

import { randomBytes } from 'node:crypto'

export const GATEWAY_KEY_REF = 'gateway:local-key'

const KEY_PREFIX = 'mgw_'
// Fixed-width bullet run: the mask must not disclose how long the key is.
const MASK_BULLETS = '•'.repeat(11)
const VISIBLE_TAIL = 4

// Narrow view of CredentialService — everything this module needs, nothing more.
export interface GatewayKeyStore {
  hasCredential(ref: string): Promise<boolean>
  getCredential(ref: string): Promise<string | null>
  setCredential(ref: string, secret: string): Promise<void>
}

export function generateGatewayKey(): string {
  return KEY_PREFIX + randomBytes(16).toString('hex')
}

export function maskGatewayKey(key: string | null): string {
  if (!key) return ''
  return KEY_PREFIX + MASK_BULLETS + key.slice(-VISIBLE_TAIL)
}

// Idempotent: returns the stored key, generating one only when absent.
export async function ensureGatewayKey(credentials: GatewayKeyStore): Promise<string> {
  if (await credentials.hasCredential(GATEWAY_KEY_REF)) {
    const existing = await credentials.getCredential(GATEWAY_KEY_REF)
    if (existing) return existing
  }
  const key = generateGatewayKey()
  await credentials.setCredential(GATEWAY_KEY_REF, key)
  return key
}

// Unlike ensureGatewayKey, this deliberately replaces the stored key.
export async function regenerateGatewayKey(credentials: GatewayKeyStore): Promise<string> {
  const key = generateGatewayKey()
  await credentials.setCredential(GATEWAY_KEY_REF, key)
  return key
}
