import type { Fetcher } from '@meow-gateway/oauth-core'
import { ANTIGRAVITY_BASE_URLS } from './metadata'

export function antigravityUserAgent(): string {
  return `antigravity/1.0 (${'unknown'} ${'unknown'}) google-api-nodejs-client/11.0.0`
}

export function antigravityXGoogApiClient(): string {
  return 'gl-node/18.0.0'
}

// Matches the `LoadCodeAssistRequest.metadata` `ClientMetadata` proto that the
// real Antigravity / Cloud Code Assist API requires. The gateway sends the same
// shape google's own gemini-cli sends (see CodeAssistServer.getClientMetadata).
// Sending an unrecognised metadata payload (e.g. { appVersion }) makes the
// server reject the request with 400 INVALID_ARGUMENT on every base URL.
export interface CloudCodeAssistClientMetadata {
  ideName: 'GEMINI_CLI'
  pluginType: 'GEMINI'
  ideVersion: string
  platform: string
}

export function cloudCodeAssistClientMetadata(ideVersion: string): CloudCodeAssistClientMetadata {
  let platform = 'PLATFORM_UNSPECIFIED'
  if (process.platform === 'darwin' && process.arch === 'arm64') platform = 'DARWIN_ARM64'
  else if (process.platform === 'darwin') platform = 'DARWIN_AMD64'
  else if (process.platform === 'win32') platform = 'WINDOWS_AMD64'
  else if (process.platform === 'linux' && process.arch === 'arm64') platform = 'LINUX_ARM64'
  else if (process.platform === 'linux') platform = 'LINUX_AMD64'
  return { ideName: 'GEMINI_CLI', pluginType: 'GEMINI', ideVersion, platform }
}

function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>
    // The real LoadCodeAssistResponse carries the project in
    // `cloudaicompanionProject`. The gateway also passes a project object whose
    // id lives directly under `id`/`projectId`, and some deployments nest it
    // under `project`. All shapes are handled leniently here.
    for (const key of ['cloudaicompanionProject', 'projectId', 'project_id', 'id']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    const sub = o['project']
    if (typeof sub === 'object' && sub !== null) {
      return extractProjectId(sub)
    }
  }
  return undefined
}

export interface ResolveProjectParams {
  accessToken: string
  baseUrls?: string[]
  cachedProjectId?: string
  fetcher: Fetcher
  // Optional debug logger (defaults to console). Never logs the access token.
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
}

export async function resolveProjectId(params: ResolveProjectParams): Promise<string> {
  const logger = params.logger ?? console
  if (params.cachedProjectId) {
    logger.log(`[antigravity] project from cache: ${params.cachedProjectId}`)
    return params.cachedProjectId
  }
  const baseUrls = params.baseUrls ?? ANTIGRAVITY_BASE_URLS
  let lastError: Error | undefined
  for (const base of baseUrls) {
    const url = `${base}/v1internal:loadCodeAssist`
    try {
      logger.log(`[antigravity] loadCodeAssist on ${base}`)
      const res = await params.fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'User-Agent': antigravityUserAgent(),
          'x-goog-api-client': antigravityXGoogApiClient(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          metadata: cloudCodeAssistClientMetadata('1.0'),
          mode: 'FULL_ELIGIBILITY_CHECK'
        })
      })
      if (!res.ok) {
        logger.warn(`[antigravity] loadCodeAssist failed (${res.status}) on ${base}`)
        lastError = new Error(`loadCodeAssist failed (${res.status}) on ${base}`)
        continue
      }
      const raw = (await res.json()) as { project?: unknown; projectId?: unknown; cloudaicompanionProject?: unknown; metadata?: Record<string, unknown> }
      // The real LoadCodeAssistResponse returns the project id as
      // `cloudaicompanionProject`; the other shapes are lenient fallbacks.
      const proj =
        extractProjectId(raw.cloudaicompanionProject) ??
        extractProjectId(raw.project) ??
        extractProjectId(raw.projectId) ??
        extractProjectId(raw.metadata?.['project'])
      if (proj) return proj
      lastError = new Error('loadCodeAssist returned no project id (account not provisioned).')
      // Spec deviation (acceptable initial slice): the design doc's step 3 —
      // auto-provisioning a brand-new account via `v1internal:onboardUser` +
      // operation polling — is intentionally NOT implemented yet. Instead we
      // surface a clear error so the user knows to use the provider in the
      // Antigravity IDE once to create the project. Extend here when the
      // onboard path is needed.
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw new Error(lastError?.message ?? 'Could not resolve project id.')
}
