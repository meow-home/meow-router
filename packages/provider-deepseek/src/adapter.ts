import {
  ProviderError,
  type ProviderAdapter,
  type ProviderContext,
  type ModelInfo,
  type CredentialCheckResult,
  type NormalizedChatRequest,
  type NormalizedChatChunk,
  type GatewayErrorType
} from '@meow-gateway/provider-core'
import { createOpenAICompatibleAdapter, type Fetcher } from '@meow-gateway/provider-openai'
import { deepseekMetadata, DEEPSEEK_CAPABILITIES, DEEPSEEK_MODELS } from './metadata'

// DeepSeekAdapter composes the OpenAI-compatible adapter for chat/validation and
// overlays DeepSeek-specific model capabilities + sane defaults.
export class DeepSeekAdapter implements ProviderAdapter {
  readonly id: string
  private readonly base: ProviderAdapter

  constructor(id: string = deepseekMetadata.id, fetcher?: Fetcher) {
    this.id = id
    // Delegate chat + auth/error mapping to the OpenAI-compatible implementation.
    this.base = createOpenAICompatibleAdapter(id, fetcher)
  }

  private capabilityFor(modelId: string): ModelInfo['capabilities'] {
    const known = DEEPSEEK_CAPABILITIES[modelId as keyof typeof DEEPSEEK_CAPABILITIES]
    if (known) return { ...known }
    // Unknown DeepSeek model: assume streaming + no vision/reasoning/structured.
    return { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false }
  }

  async getModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    let dynamic: ModelInfo[] = []
    try {
      dynamic = await this.base.getModels(ctx)
    } catch {
      dynamic = []
    }
    // Merge the static known list with any dynamic models, deduped by id.
    const byId = new Map<string, ModelInfo>()
    for (const m of DEEPSEEK_MODELS) {
      byId.set(m.id, {
        id: m.id,
        providerModelId: m.id,
        displayName: m.displayName,
        capabilities: this.capabilityFor(m.id)
      })
    }
    for (const m of dynamic) {
      byId.set(m.id, {
        ...m,
        capabilities: this.capabilityFor(m.id)
      })
    }
    return [...byId.values()]
  }

  validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult> {
    return this.base.validateCredentials(ctx)
  }

  chat(
    ctx: ProviderContext,
    request: NormalizedChatRequest
  ): AsyncIterable<NormalizedChatChunk> {
    return this.base.chat(ctx, request)
  }
}

// Map any caught error this adapter re-throws through the normalized taxonomy.
export function mapDeepseekError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  const type: GatewayErrorType = 'INTERNAL_ERROR'
  return new ProviderError({ type, message: err instanceof Error ? err.message : 'DeepSeek request failed.', retryable: false })
}

export function createDeepSeekAdapter(id: string = deepseekMetadata.id, fetcher?: Fetcher): ProviderAdapter {
  return new DeepSeekAdapter(id, fetcher)
}
