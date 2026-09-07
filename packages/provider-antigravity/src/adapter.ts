import { randomUUID } from 'node:crypto'
import {
  ProviderError, type ProviderAdapter, type ProviderContext, type CredentialCheckResult,
  type ModelInfo, type NormalizedChatRequest, type NormalizedChatChunk, assertSafeEndpoint
} from '@meow-gateway/provider-core'
import { OAuthTokenManager, type OAuthTokenBundle, type Fetcher, defaultFetcher } from '@meow-gateway/oauth-core'
import { antigravityMetadata, ANTIGRAVITY_SYSTEM_PROMPT } from './metadata'
import { resolveProjectId } from './project'

const STREAM_PATH = '/v1internal:streamGenerateContent?alt=sse'
const FETCH_MODELS_PATH = '/v1internal:fetchAvailableModels'

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

function parseBundle(raw: string | undefined): OAuthTokenBundle | undefined {
  if (!raw) return undefined
  try {
    const b = JSON.parse(raw) as Partial<OAuthTokenBundle>
    if (typeof b.accessToken === 'string' && b.accessToken) {
      return {
        accessToken: b.accessToken,
        refreshToken: typeof b.refreshToken === 'string' ? b.refreshToken : '',
        tokenType: b.tokenType || 'Bearer',
        expiresAt: typeof b.expiresAt === 'number' ? b.expiresAt : Date.now() + 3600_000,
        idToken: b.idToken,
        oauthClientKey: b.oauthClientKey,
        scope: b.scope,
        projectId: b.projectId
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export interface AntigravityAdapterOptions {
  tokenManager?: OAuthTokenManager
  fetcher?: Fetcher
  fallbackModels?: string[]
}

interface ResolvedAuth {
  accessToken: string
  bundle?: OAuthTokenBundle
  ref?: string
}

export class AntigravityAdapter implements ProviderAdapter {
  readonly id: string
  private readonly fetcher: Fetcher
  private readonly tokenManager?: OAuthTokenManager
  private readonly fallbackModels: string[]

  constructor(id: string = antigravityMetadata.id, opts: AntigravityAdapterOptions = {}) {
    this.id = id
    this.fetcher = opts.fetcher ?? defaultFetcher()
    this.tokenManager = opts.tokenManager
    this.fallbackModels = opts.fallbackModels ?? ['gemini-2.5-pro', 'gemini-2.5-flash']
  }

  private resolveBaseUrl(ctx: ProviderContext): string {
    return ctx.baseUrl || antigravityMetadata.defaultBaseUrl
  }

  private assertEndpointSafe(ctx: ProviderContext): void {
    const r = assertSafeEndpoint(this.resolveBaseUrl(ctx))
    if (!r.ok) throw new ProviderError({ type: 'REQUEST_REJECTED', message: `Unsafe provider endpoint: ${r.reason}`, retryable: false })
  }

  private async resolveAuth(ctx: ProviderContext): Promise<ResolvedAuth> {
    const bundle = parseBundle(ctx.credential)
    if (this.tokenManager && ctx.credentialRef) {
      const accessToken = await this.tokenManager.getAccessToken(ctx.credentialRef)
      const current = await this.tokenManager.getBundle(ctx.credentialRef)
      return { accessToken, bundle: current ?? bundle, ref: ctx.credentialRef }
    }
    if (bundle?.accessToken) return { accessToken: bundle.accessToken, bundle }
    throw new ProviderError({ type: 'AUTH_ERROR', message: 'No Antigravity OAuth token configured.', retryable: false })
  }

  private async headers(_ctx: ProviderContext, accessToken: string): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': 'antigravity',
      'x-goog-api-client': 'gl-node/18'
    }
  }

  async getModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    this.assertEndpointSafe(ctx)
    const { accessToken } = await this.resolveAuth(ctx)
    for (const base of this.baseUrlsToTry(ctx)) {
      const url = joinUrl(base, FETCH_MODELS_PATH)
      try {
        const res = await this.fetcher(url, { method: 'POST', headers: await this.headers(ctx, accessToken), body: '{}', signal: ctx.signal })
        if (res.ok) {
          const data = (await res.json()) as { payload?: { models?: Record<string, unknown> }; models?: Record<string, unknown> }
          const map = data.payload?.models ?? data.models ?? {}
          const ids = Object.keys(map).filter((k) => !k.includes('legacy'))
          if (ids.length === 0) break
          return ids.map((id) => ({
            id,
            providerModelId: id,
            displayName: id,
            capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false }
          }))
        }
      } catch {
        // try next base url
      }
    }
    return this.fallbackModels.map((id) => ({
      id,
      providerModelId: id,
      displayName: id,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true, structuredOutput: false }
    }))
  }

  private baseUrlsToTry(ctx: ProviderContext): string[] {
    const base = this.resolveBaseUrl(ctx)
    return [base, ...antigravityMetadata.fallbackBaseUrls.filter((b) => b !== base)]
  }

  async validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult> {
    try {
      await this.resolveAuth(ctx)
      return { ok: true, message: 'Antigravity OAuth token resolved.' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Validation failed.' }
    }
  }

  async *chat(ctx: ProviderContext, request: NormalizedChatRequest): AsyncIterable<NormalizedChatChunk> {
    this.assertEndpointSafe(ctx)
    const { accessToken, bundle } = await this.resolveAuth(ctx)
    const projectId = await this.resolveProject(ctx, accessToken, bundle)
    const id = 'req_' + randomUUID()
    const messages = request.messages.map((m) => ({ role: m.role, parts: [{ text: String(m.content) }] }))
    const body = {
      project: projectId,
      requestId: id,
      model: request.model,
      userAgent: 'antigravity',
      requestType: 'agent',
      request: {
        contents: messages,
        session_id: 'sess_' + randomUUID().slice(0, 8),
        systemInstruction: { parts: [{ text: ANTIGRAVITY_SYSTEM_PROMPT }] },
        generationConfig: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens && request.maxTokens > 0 ? { maxOutputTokens: request.maxTokens } : {})
        }
      }
    }

    let res
    try {
      res = await this.fetcher(joinUrl(this.resolveBaseUrl(ctx), STREAM_PATH), {
        method: 'POST',
        headers: await this.headers(ctx, accessToken),
        body: JSON.stringify(body),
        signal: ctx.signal
      })
    } catch {
      if (ctx.signal.aborted) throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Request to provider failed.', retryable: true })
    }

    if (!res.ok) throw this.errorFromStatus(res.status)

    const shouldStream = request.stream !== false
    const chunks: NormalizedChatChunk[] = []
    for await (const chunk of this.parseSse(res, ctx.signal)) chunks.push(chunk)

    if (!shouldStream) {
      yield* this.asNonStreamingChunks(chunks)
      return
    }
    yield* chunks
  }

  private async resolveProject(ctx: ProviderContext, accessToken: string, bundle: OAuthTokenBundle | undefined): Promise<string> {
    try {
      const projectId = await resolveProjectId({
        accessToken,
        cachedProjectId: bundle?.projectId,
        baseUrls: this.baseUrlsToTry(ctx),
        fetcher: this.fetcher
      })
      if (this.tokenManager && ctx.credentialRef && !bundle?.projectId) {
        await this.tokenManager.setProjectId(ctx.credentialRef, projectId).catch(() => {})
      }
      return projectId
    } catch (err) {
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: `Could not resolve Antigravity project: ${err instanceof Error ? err.message : String(err)}`, retryable: false })
    }
  }

  private errorFromStatus(status: number): ProviderError {
    if (status === 401 || status === 403) return new ProviderError({ type: 'AUTH_ERROR', status, message: 'Antigravity authentication failed.', retryable: false })
    if (status === 429) return new ProviderError({ type: 'RATE_LIMIT', status, message: 'Antigravity rate limited.', retryable: true })
    if (status >= 500) return new ProviderError({ type: 'PROVIDER_UNAVAILABLE', status, message: 'Antigravity server error.', retryable: true })
    return new ProviderError({ type: 'CLIENT_ERROR', status, message: 'Antigravity request rejected.', retryable: false })
  }

  private async *parseSse(res: Awaited<ReturnType<Fetcher>>, signal?: AbortSignal): AsyncIterable<NormalizedChatChunk> {
    try {
      const reader = (res.body as ReadableStream<Uint8Array> | undefined)?.getReader()
      if (!reader) { yield* this.parseSseText(await res.text()); return }
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false
      while (!done) {
        const { value, done: stop } = await reader.read()
        done = stop
        buffer += decoder.decode(value, { stream: !done })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const c of this.parseEventLines(block)) yield c
        }
      }
      if (buffer.trim()) { for (const c of this.parseEventLines(buffer)) yield c }
    } catch {
      if (signal?.aborted) throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Provider closed the stream unexpectedly.', retryable: true })
    }
  }

  private async *parseSseText(text: string): AsyncIterable<NormalizedChatChunk> {
    for (const block of text.split('\n\n')) { for (const c of this.parseEventLines(block)) yield c }
  }

  private *parseEventLines(block: string): Iterable<NormalizedChatChunk> {
    let accumulated = ''
    let finishReason: string | undefined
    const usage = (obj: unknown): NormalizedChatChunk['usage'] => {
      const o = obj as Record<string, unknown>
      const um = o['usageMetadata'] as Record<string, unknown> | undefined
      return {
        inputTokens: typeof um?.['promptTokenCount'] === 'number' ? um['promptTokenCount'] : 0,
        outputTokens: typeof um?.['candidatesTokenCount'] === 'number' ? um['candidatesTokenCount'] : 0,
        cachedTokens: 0
      }
    }
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(payload) } catch { continue }
      const response = (parsed['response'] ?? parsed) as Record<string, unknown>
      const candidates = (response['candidates'] as unknown[] | undefined) ?? [response]
      for (const c of candidates) {
        const cand = c as Record<string, unknown>
        if (typeof cand['finishReason'] === 'string') finishReason = cand['finishReason']
        const content = cand['content'] as Record<string, unknown> | undefined
        const parts = (content?.['parts'] as unknown[] | undefined) ?? []
        for (const p of parts) {
          const part = p as Record<string, unknown>
          if (part['thought'] === true) continue
          if (typeof part['text'] === 'string' && part['text']) accumulated += part['text']
        }
      }
      const finish = finishReason ?? (response['usageMetadata'] ? 'stop' : undefined)
      if (accumulated) {
        yield { id: 'x', kind: 'content_delta', delta: accumulated }
        accumulated = ''
      }
      if (finish || response['usageMetadata']) {
        yield { id: 'x', kind: 'finish', finishReason: finish ?? 'stop', ...(response['usageMetadata'] ? { usage: usage(response) } : {}) }
      }
    }
    if (accumulated) yield { id: 'x', kind: 'content_delta', delta: accumulated }
  }

  private *asNonStreamingChunks(chunks: NormalizedChatChunk[]): Iterable<NormalizedChatChunk> {
    const text = chunks.filter((c) => c.kind === 'content_delta').map((c) => c.delta ?? '').join('')
    yield { id: 'x', kind: 'content_delta', delta: text }
    const finish = chunks.find((c) => c.kind === 'finish')
    yield { id: 'x', kind: 'finish', finishReason: finish?.finishReason ?? 'stop', usage: finish?.usage }
  }
}

export function createAntigravityAdapter(id?: string, opts?: AntigravityAdapterOptions): AntigravityAdapter {
  return new AntigravityAdapter(id, opts)
}
