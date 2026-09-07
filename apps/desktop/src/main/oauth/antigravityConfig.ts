import { ANTIGRAVITY_OAUTH_CLIENT } from '@meow-gateway/provider-antigravity'
import type { OAuthClientConfig } from '@meow-gateway/oauth-core'

// Map of provider type -> OAuth client config. Kept provider-neutral: each
// OAuth-backed provider type that needs login contributes an entry here.
export const OAUTH_CLIENT_FOR_TYPE: Record<string, OAuthClientConfig> = {
  antigravity: ANTIGRAVITY_OAUTH_CLIENT
}

export function clientForType(type: string): OAuthClientConfig {
  const cfg = OAUTH_CLIENT_FOR_TYPE[type]
  if (!cfg) throw new Error(`No OAuth client configured for provider type: ${type}`)
  return cfg
}
