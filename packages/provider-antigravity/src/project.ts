import type { Fetcher } from '@meow-gateway/oauth-core'
import { ANTIGRAVITY_BASE_URLS } from './metadata'

export function antigravityUserAgent(): string {
  return `antigravity/1.0 (${'unknown'} ${'unknown'}) google-api-nodejs-client/11.0.0`
}

export function antigravityXGoogApiClient(): string {
  return 'gl-node/18.0.0'
}

function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>
    for (const key of ['id', 'projectId', 'project_id']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return undefined
}

export interface ResolveProjectParams {
  accessToken: string
  baseUrls?: string[]
  cachedProjectId?: string
  fetcher: Fetcher
}

export async function resolveProjectId(params: ResolveProjectParams): Promise<string> {
  if (params.cachedProjectId) return params.cachedProjectId
  const baseUrls = params.baseUrls ?? ANTIGRAVITY_BASE_URLS
  let lastError: Error | undefined
  for (const base of baseUrls) {
    const url = `${base}/v1internal:loadCodeAssist`
    try {
      const res = await params.fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'User-Agent': antigravityUserAgent(),
          'x-goog-api-client': antigravityXGoogApiClient(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metadata: { appVersion: '1.0' }, mode: 'FULL_ELIGIBILITY_CHECK' })
      })
      if (!res.ok) {
        lastError = new Error(`loadCodeAssist failed (${res.status}) on ${base}`)
        continue
      }
      const raw = (await res.json()) as { project?: unknown; projectId?: unknown; metadata?: Record<string, unknown> }
      const proj =
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
