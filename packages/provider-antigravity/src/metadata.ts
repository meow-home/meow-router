import type { OAuthClientConfig } from '@meow-gateway/oauth-core'

export interface AntigravityMetadata {
  id: string
  displayName: string
  defaultBaseUrl: string
  authType: 'oauth'
  fallbackBaseUrls: string[]
}

export const ANTIGRAVITY_BASE_URLS: string[] = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com'
]

export const antigravityMetadata: AntigravityMetadata = {
  id: 'antigravity',
  displayName: 'Antigravity',
  defaultBaseUrl: ANTIGRAVITY_BASE_URLS[0],
  authType: 'oauth',
  fallbackBaseUrls: ANTIGRAVITY_BASE_URLS.slice(1)
}

// DANGER (dev-only): These are the Antigravity Google OAuth client credentials,
// mirroring cockpit-tools. This intentionally deviates from AGENTS.md
// ("do not hard-code provider secrets") to enable a working POC. MUST be
// replaced with user-supplied credentials or a real backend secret store before
// shipping. See design spec "Bảo mật".
export const ANTIGRAVITY_OAUTH_CLIENT: OAuthClientConfig = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: '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',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: ['openid', 'https://www.googleapis.com/auth/cloud-platform']
}

export const ANTIGRAVITY_SYSTEM_PROMPT =
  'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding. You are pair programming with a USER to solve their coding task.'

export const DEFAULT_UA_OS = 'unknown'
export const DEFAULT_UA_ARCH = 'unknown'
