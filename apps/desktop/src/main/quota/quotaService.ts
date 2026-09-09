import type { AntigravityAdapter } from '@meow-gateway/provider-antigravity'
import type { QuotaItem } from '@meow-gateway/provider-antigravity'
import { parseQuotaResponse } from '@meow-gateway/provider-antigravity'
import type { OAuthTokenManager } from '@meow-gateway/oauth-core'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { AntigravityQuotaData } from '../../shared/ipc'

export interface QuotaServiceDeps {
  adapter: AntigravityAdapter
  tokenManager: OAuthTokenManager
  providerRepo: ProviderRepository
  /** Credential service for resolving OAuth token bundles. */
  getCredential: (ref: string) => Promise<string | null>
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
  pollIntervalMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 60_000

export class QuotaService {
  private readonly cache = new Map<string, AntigravityQuotaData>()
  private readonly adapter: AntigravityAdapter
  private readonly providerRepo: ProviderRepository
  private readonly getCredential: (ref: string) => Promise<string | null>
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: QuotaServiceDeps) {
    this.adapter = deps.adapter
    this.providerRepo = deps.providerRepo
    this.getCredential = deps.getCredential
    this.logger = deps.logger ?? console
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  /** Return cached quota data for all Antigravity accounts. */
  getAll(): AntigravityQuotaData[] {
    return Array.from(this.cache.values())
  }

  /** Return cached quota data for one account, or undefined. */
  getByProvider(providerId: string): AntigravityQuotaData | undefined {
    return this.cache.get(providerId)
  }

  /** Fetch quota for all Antigravity accounts, update cache. */
  async refreshAll(): Promise<AntigravityQuotaData[]> {
    const providers = this.providerRepo.list().filter((p) => p.type === 'antigravity')
    // Fetch all in parallel — errors are isolated per account.
    await Promise.all(
      providers.map((p) => this.refreshProvider(p.id).catch(() => {}))
    )
    return this.getAll()
  }

  /** Fetch quota for one account, update cache. */
  async refreshProvider(providerId: string): Promise<AntigravityQuotaData> {
    const credentialRef = `provider:${providerId}`
    try {
      const credential = await this.getCredential(credentialRef)
      if (!credential) throw new Error('No stored credential for this account.')
      const raw = await this.adapter.getQuota({
        credentialRef,
        credential,
        signal: new AbortController().signal,
        requestId: `quota-${providerId}-${Date.now()}`
      })
      const items: QuotaItem[] = parseQuotaResponse(raw)
      const data: AntigravityQuotaData = {
        providerId,
        items,
        tier: raw.tier ?? '',
        lastUpdatedAt: Date.now()
      }
      this.cache.set(providerId, data)
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`[quota] fetch failed for ${providerId}: ${message}`)
      // Preserve old items if we have them, just update error + timestamp
      const existing = this.cache.get(providerId)
      const data: AntigravityQuotaData = {
        providerId,
        items: existing?.items ?? [],
        tier: existing?.tier ?? '',
        lastUpdatedAt: existing?.lastUpdatedAt ?? Date.now(),
        error: message
      }
      this.cache.set(providerId, data)
      return data
    }
  }

  /** Start polling. Safe to call multiple times. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.refreshAll().catch((err) => {
        this.logger.warn(`[quota] poll cycle failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, this.pollIntervalMs)
    // Fetch immediately on start
    this.refreshAll().catch(() => {})
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
