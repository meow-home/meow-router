import type { CredentialService } from '../credentials/credentialService'
import type { OAuthTokenBundle, OAuthTokenStore } from '@meow-gateway/oauth-core'

// Bridges the oauth-core OAuthTokenStore interface onto the existing OS
// secure-store-backed CredentialService. Bundles are stored as JSON; the same
// ref namespace as gateway credentials (`provider:<id>`) is used so that 1
// provider = 1 account and the gateway needs no changes.
export class SecureOAuthTokenStore implements OAuthTokenStore {
  constructor(private readonly credentials: CredentialService) {}

  async get(ref: string): Promise<OAuthTokenBundle | null> {
    const raw = await this.credentials.getCredential(ref)
    if (!raw) return null
    try {
      return JSON.parse(raw) as OAuthTokenBundle
    } catch {
      return null
    }
  }

  async set(ref: string, bundle: OAuthTokenBundle): Promise<void> {
    await this.credentials.setCredential(ref, JSON.stringify(bundle))
  }

  async delete(ref: string): Promise<void> {
    await this.credentials.deleteCredential(ref)
  }
}
