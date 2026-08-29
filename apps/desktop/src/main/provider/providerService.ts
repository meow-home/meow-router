// Provider service (main process).
//
// Coordinates the provider repository, account (credential_ref) repository,
// model repository, credential service and provider registry so the renderer
// never touches provider SDKs or raw credentials. Credentials are stored via
// the OS secure store (main only); they are never returned to the renderer.
//
// This is the ONLY place that builds a ProviderContext for the provider
// adapters (getModels / validateCredentials).

import { randomUUID } from 'node:crypto'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { AccountRepository } from '../database/repositories/accountRepository'
import type { ModelRepository } from '../database/repositories/modelRepository'
import type { CredentialService } from '../credentials/credentialService'
import { ProviderError, assertSafeEndpoint, type ProviderRegistry, type ModelInfo, type CredentialCheckResult } from '@meow-gateway/provider-core'
import { openaiCompatibleMetadata } from '@meow-gateway/provider-openai'
import { deepseekMetadata } from '@meow-gateway/provider-deepseek'
import type { ProviderRow, ModelRow, NewModel } from '../database/types'
import type { NewProviderInput, ProviderWithCredential, ProviderTypeDescriptor } from '../../shared/ipc'

function credentialRefFor(providerId: string): string {
  // Refs must satisfy VALID_REF_RE in the credential service (/^[\w.:/-]+$/).
  return `provider:${providerId}`
}

// Known provider metadata keyed by adapter id. This mirrors the provider
// packages; the registry is the runtime source of truth for WHICH providers
// exist (ids), while this map supplies display metadata. New providers just
// register an adapter and add an entry here — no picker change.
const KNOWN_METADATA: Record<string, ProviderTypeDescriptor> = {
  openai: { id: 'openai', displayName: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', authType: 'bearer' },
  [openaiCompatibleMetadata.id]: { id: openaiCompatibleMetadata.id, displayName: openaiCompatibleMetadata.displayName, defaultBaseUrl: openaiCompatibleMetadata.defaultBaseUrl, authType: openaiCompatibleMetadata.authType },
  deepseek: { id: deepseekMetadata.id, displayName: deepseekMetadata.displayName, defaultBaseUrl: deepseekMetadata.defaultBaseUrl, authType: deepseekMetadata.authType },
  openrouter: { id: 'openrouter', displayName: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', authType: 'bearer' },
  groq: { id: 'groq', displayName: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', authType: 'bearer' },
  ollama: { id: 'ollama', displayName: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434/v1', authType: 'bearer' },
  lmstudio: { id: 'lmstudio', displayName: 'LM Studio', defaultBaseUrl: 'http://127.0.0.1:1234/v1', authType: 'bearer' }
}

export class ProviderService {
  constructor(
    private readonly providerRepo: ProviderRepository,
    private readonly accountRepo: AccountRepository,
    private readonly modelRepo: ModelRepository,
    private readonly credentials: CredentialService,
    private readonly registry: ProviderRegistry
  ) {}

  async listWithCredential(): Promise<ProviderWithCredential[]> {
    const providers = this.providerRepo.list()
    const result: ProviderWithCredential[] = []
    for (const p of providers) {
      const accounts = this.accountRepo.listByProvider(p.id)
      result.push({ ...p, hasCredential: accounts.length > 0 })
    }
    return result
  }

  create(input: NewProviderInput): ProviderRow {
    if (!this.registry.get(input.type)) {
      throw new ProviderError({ type: 'INVALID_INPUT', message: `Unknown provider type: ${input.type}`, retryable: false })
    }
    if (input.base_url) {
      const sr = assertSafeEndpoint(input.base_url)
      if (!sr.ok) {
        throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${sr.reason}`, retryable: false })
      }
    }
    return this.providerRepo.create({ type: input.type, display_name: input.display_name, base_url: input.base_url ?? null })
  }

  update(id: string, patch: Partial<Omit<ProviderRow, 'id' | 'created_at'>>): ProviderRow | undefined {
    if (patch.type !== undefined) {
      throw new ProviderError({ type: 'INVALID_INPUT', message: 'Provider type cannot be changed after creation.', retryable: false })
    }
    if (patch.base_url !== undefined && patch.base_url !== null) {
      const sr = assertSafeEndpoint(patch.base_url)
      if (!sr.ok) {
        throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${sr.reason}`, retryable: false })
      }
    }
    return this.providerRepo.update(id, patch)
  }

  delete(id: string): boolean {
    return this.providerRepo.delete(id)
  }

  async setCredential(id: string, secret: string): Promise<void> {
    if (!this.providerRepo.findById(id)) throw new Error(`Provider not found: ${id}`)
    const ref = credentialRefFor(id)
    await this.credentials.setCredential(ref, secret)
    // Ensure an account row links the provider to the credential ref (idempotent).
    const existing = this.accountRepo.listByProvider(id)
    if (existing.length === 0) {
      this.accountRepo.create({ provider_id: id, display_name: 'Primary', credential_ref: ref, status: 'active' })
    } else {
      this.accountRepo.update(existing[0].id, { credential_ref: ref })
    }
  }

  async testConnection(id: string): Promise<CredentialCheckResult> {
    const provider = this.providerRepo.findById(id)
    if (!provider) return { ok: false, message: 'Provider not found.' }
    const adapter = this.registry.get(provider.type)
    if (!adapter) return { ok: false, message: `No adapter for type: ${provider.type}` }
    const ref = credentialRefFor(id)
    const secret = await this.credentials.getCredential(ref)
    return adapter.validateCredentials({
      credentialRef: ref,
      credential: secret ?? undefined,
      baseUrl: provider.base_url ?? undefined,
      signal: new AbortController().signal,
      requestId: randomUUID()
    })
  }

  async discoverModels(id: string): Promise<ModelInfo[]> {
    const provider = this.providerRepo.findById(id)
    if (!provider) throw new Error(`Provider not found: ${id}`)
    const adapter = this.registry.get(provider.type)
    if (!adapter) throw new Error(`No adapter for type: ${provider.type}`)
    const ref = credentialRefFor(id)
    const secret = await this.credentials.getCredential(ref)
    const models = await adapter.getModels({
      credentialRef: ref,
      credential: secret ?? undefined,
      baseUrl: provider.base_url ?? undefined,
      signal: new AbortController().signal,
      requestId: randomUUID()
    })
    // Safe upsert: preserve the user's enabled/disabled choice, only refresh metadata.
    const present: Array<{ providerModelId: string }> = []
    for (const m of models) {
      present.push({ providerModelId: m.providerModelId })
      const existing = this.modelRepo.findByProviderModel(id, m.providerModelId)
      this.modelRepo.upsertByProviderModel({
        provider_id: id,
        provider_model_id: m.providerModelId,
        display_name: m.displayName,
        context_window: m.contextWindow ?? null,
        input_price: m.inputPrice ?? null,
        output_price: m.outputPrice ?? null,
        capabilities_json: JSON.stringify(m.capabilities),
        enabled: existing?.enabled ?? true
      })
    }

    // Anything under this provider not in the API response becomes stale.
    for (const row of this.modelRepo.listByProvider(id)) {
      if (!present.some((p) => p.providerModelId === row.provider_model_id)) {
        this.modelRepo.update(row.id, { stale: true })
      }
    }

    return models
  }

  createModel(input: NewModel): ModelRow {
    if (!this.providerRepo.findById(input.provider_id)) {
      throw new ProviderError({ type: 'INVALID_INPUT', message: `Provider not found: ${input.provider_id}`, retryable: false })
    }
    return this.modelRepo.create(input)
  }

  updateModel(id: string, patch: Partial<Omit<NewModel, 'id'>>): ModelRow | undefined {
    if (patch.provider_id !== undefined) {
      throw new ProviderError({ type: 'INVALID_INPUT', message: 'Model provider_id cannot be changed after creation.', retryable: false })
    }
    if (!this.modelRepo.findById(id)) {
      throw new ProviderError({ type: 'MODEL_NOT_FOUND', message: 'Model not found', retryable: false })
    }
    return this.modelRepo.update(id, patch)
  }

  providerTypes(): ProviderTypeDescriptor[] {
    return this.registry.ids().map((id) => KNOWN_METADATA[id] ?? { id, displayName: id, defaultBaseUrl: '', authType: 'bearer' })
  }
}
