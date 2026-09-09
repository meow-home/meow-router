export {
  antigravityMetadata,
  ANTIGRAVITY_OAUTH_CLIENT,
  ANTIGRAVITY_SYSTEM_PROMPT,
  ANTIGRAVITY_BASE_URLS,
  DEFAULT_UA_OS,
  DEFAULT_UA_ARCH,
  type AntigravityMetadata
} from './metadata'
export { resolveProjectId, type ResolveProjectParams } from './project'
export { createAntigravityAdapter, type AntigravityAdapterOptions, type AntigravityAdapter } from './adapter'
export { parseQuotaResponse, type QuotaItem, type RawQuotaResponse } from './quotaParser'
