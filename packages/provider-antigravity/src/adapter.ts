import { randomUUID } from 'node:crypto'
import {
  ProviderError, type ProviderAdapter, type ProviderContext, type CredentialCheckResult,
  type ModelInfo, type NormalizedChatRequest, type NormalizedChatChunk, assertSafeEndpoint
} from '@meow-gateway/provider-core'
import { OAuthTokenManager, type OAuthTokenBundle, type Fetcher, defaultFetcher } from '@meow-gateway/oauth-core'
import { antigravityMetadata, ANTIGRAVITY_SYSTEM_PROMPT } from './metadata'
import { resolveProjectId } from './project'
import type { RawQuotaResponse } from './quotaParser'

const STREAM_PATH = '/v1internal:streamGenerateContent?alt=sse'
const FETCH_MODELS_PATH = '/v1internal:fetchAvailableModels'
const QUOTA_SUMMARY_PATH = '/v1internal:retrieveUserQuotaSummary'

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

// The Gemini `Schema` accepts only a subset of OpenAPI 3.0 / JSON Schema
// keywords. Clients (e.g. the AI SDK) send full JSON Schema in `parameters`
// including `$schema`, `exclusiveMinimum`, `additionalProperties`, etc., which
// the Cloud Code Assist API rejects with 400 INVALID_ARGUMENT ("Unknown name
// ... Cannot find field"). We keep only the keywords Gemini understands and
// recurse into nested schemas (`properties`, `items`, `anyOf`).
const GEMINI_SCHEMA_KEYS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum',
  'maxItems', 'minItems', 'properties', 'required', 'minProperties', 'maxProperties',
  'minLength', 'maxLength', 'pattern', 'example', 'anyOf', 'propertyOrdering',
  'default', 'items', 'minimum', 'maximum'
])

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_KEYS.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = sanitizeSchema(pv)
      out[k] = props
    } else if (k === 'items' || k === 'anyOf') {
      out[k] = sanitizeSchema(v)
    } else {
      out[k] = v
    }
  }
  return out
}

// Translates OpenAI-format tools (`[{ type: 'function', function: { name,
// description, parameters } }]`) into the Gemini/Antigravity `functionDeclarations`
// shape. The Cloud Code Assist API only understands `tools: [{ functionDeclarations:
// [{ name, description, parameters }] }]`; without it the model is never told
// about the tools and never emits a functionCall.
function translateTools(tools: unknown[]): unknown[] {
  const declarations: unknown[] = []
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue
    const obj = t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }
    const fn = obj.function
    if (!fn || typeof fn.name !== 'string') continue
    declarations.push({
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      ...(fn.parameters ? { parameters: sanitizeSchema(fn.parameters) } : {})
    })
  }
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : []
}

// Translates OpenAI `tool_choice` into the Gemini `toolConfig.functionCallingConfig`
// shape. `auto`/`none` map to the matching mode; a specific function maps to
// `ANY` with `allowedFunctionNames`.
function translateToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== 'object') return undefined
  const tc = toolChoice as { type?: string; function?: { name?: string } }
  if (tc.type === 'none') return { functionCallingConfig: { mode: 'NONE' } }
  if (tc.type === 'function' && tc.function?.name) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tc.function.name] } }
  }
  // 'auto' and anything else: let the model decide.
  return { functionCallingConfig: { mode: 'AUTO' } }
}

// Maps Gemini/Antigravity finish reasons to the OpenAI-compatible values the
// gateway exposes. `STOP` -> `stop`, `MAX_TOKENS` -> `length`, tool calls ->
// `tool_calls`, anything else passes through.
function mapFinishReason(reason: string): string {
  if (reason === 'STOP') return 'stop'
  if (reason === 'MAX_TOKENS') return 'length'
  if (reason === 'SAFETY') return 'content_filter'
  return reason.toLowerCase()
}

interface AntigravityPart {
  text?: string
  thoughtSignature?: string
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

interface AntigravityContent {
  role: 'user' | 'model'
  parts: AntigravityPart[]
}

// Encode a Gemini `thoughtSignature` into the tool-call id we hand to the
// client. The OpenAI tool-call id is the only field that round-trips through
// the client's assistant `tool_calls` and tool `tool_call_id`, so we stash the
// signature there and recover it in toAntigravityContents. Without it,
// resending a `functionCall` part without its `thoughtSignature` makes the
// Cloud Code Assist API reject the request with 400 INVALID_ARGUMENT
// ("Function call is missing a thought_signature in functionCall parts").
function encodeToolCallId(index: number, thoughtSignature?: string): string {
  if (!thoughtSignature) return `call_${index}`
  return `call_${index}_ts_${Buffer.from(thoughtSignature, 'utf8').toString('base64url')}`
}

function decodeToolCallId(id: string): { index: number; thoughtSignature?: string } {
  const m = /^call_(\d+)(?:_ts_(.+))?$/.exec(id)
  if (!m) return { index: 0 }
  const thoughtSignature = m[2] ? Buffer.from(m[2], 'base64url').toString('utf8') : undefined
  return { index: Number(m[1]), thoughtSignature }
}

// Converts provider-neutral (OpenAI-style) messages into the Gemini/Antigravity
// `contents` shape. The Cloud Code Assist API only accepts `user` and `model`
// roles in contents: `system` goes into `systemInstruction`, `assistant` maps to
// `model`, and `tool` results become a `user` message carrying a
// `functionResponse`. Sending OpenAI roles verbatim makes the server reject the
// request with 400 INVALID_ARGUMENT.
function toAntigravityContents(messages: NormalizedChatRequest['messages']): {
  contents: AntigravityContent[]
  systemInstruction?: { parts: AntigravityPart[] }
} {
  const contents: AntigravityContent[] = []
  const systemParts: AntigravityPart[] = []
  // Maps an OpenAI tool_call_id to the function name the model requested. The
  // Antigravity/Gemini `functionResponse.name` must equal the `functionCall.name`
  // the model emitted, NOT the tool call id. OpenAI tool messages only carry the
  // tool_call_id, so we recover the function name from the preceding assistant
  // message's tool_calls.
  const toolCallIdToName = new Map<string, string>()
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        if (m.content) systemParts.push({ text: String(m.content) })
        break
      case 'user':
        contents.push({ role: 'user', parts: [{ text: String(m.content ?? '') }] })
        break
      case 'assistant': {
        const parts: AntigravityPart[] = []
        if (m.content) parts.push({ text: String(m.content) })
        if (Array.isArray(m.toolCalls)) {
          for (const tc of m.toolCalls) {
            const t = tc as { id?: string; function?: { name?: string; arguments?: unknown } }
            const fn = t.function
            const name = fn?.name
            if (!name) continue
            if (t.id) toolCallIdToName.set(t.id, name)
            let args: Record<string, unknown> = {}
            if (typeof fn.arguments === 'string') {
              try { args = JSON.parse(fn.arguments) } catch { args = {} }
            } else if (fn.arguments && typeof fn.arguments === 'object') {
              args = fn.arguments as Record<string, unknown>
            }
            // Recover the Gemini thoughtSignature we stashed in the tool-call
            // id (see encodeToolCallId). The Cloud Code Assist API requires a
            // `functionCall` part to carry its `thoughtSignature` when it is
            // resent in a multi-turn history; omitting it yields 400
            // INVALID_ARGUMENT.
            const { thoughtSignature } = t.id ? decodeToolCallId(t.id) : { thoughtSignature: undefined }
            // The Cloud Code Assist backend translates Gemini `functionCall`
            // parts into Anthropic `tool_use` blocks for Claude models, and
            // `tool_use.id` is REQUIRED there. Echo the id from the client's
            // history (OpenAI tool_calls[].id) so the backend can pair the
            // call with its functionResponse; omitting it yields 400
            // INVALID_ARGUMENT ("messages.N.content.0.tool_use.id: Field
            // required").
            parts.push({
              ...(thoughtSignature ? { thoughtSignature } : {}),
              functionCall: { name, args, ...(t.id ? { id: t.id } : {}) }
            })
          }
        }
        if (parts.length > 0) contents.push({ role: 'model', parts })
        break
      }
      case 'tool': {
        // Use the function name recovered from the assistant tool_calls; fall
        // back to the tool_call_id only if we never saw the call.
        const name = (m.toolCallId && toolCallIdToName.get(m.toolCallId)) || m.toolCallId || 'unknown'
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name,
              ...(m.toolCallId ? { id: m.toolCallId } : {}),
              response: { result: String(m.content ?? '') }
            }
          }]
        })
        break
      }
    }
  }
  return { contents, systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined }
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
  // Minimal structured logger (defaults to console). Used for debugging the
  // Antigravity request lifecycle: token resolution, project resolution, base
  // URL fallback and SSE parsing. Never logs credentials, tokens or bodies.
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
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
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>

  constructor(id: string = antigravityMetadata.id, opts: AntigravityAdapterOptions = {}) {
    this.id = id
    this.fetcher = opts.fetcher ?? defaultFetcher()
    this.tokenManager = opts.tokenManager
    this.fallbackModels = opts.fallbackModels ?? ['gemini-2.5-pro', 'gemini-2.5-flash']
    this.logger = opts.logger ?? console
  }

  private log(msg: string, extra?: Record<string, unknown>): void {
    this.logger.log(`[antigravity] ${msg}`, extra ?? {})
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
      const expiresInSec = current?.expiresAt ? Math.round((current.expiresAt - Date.now()) / 1000) : undefined
      this.log('auth resolved', { ref: ctx.credentialRef, expiresInSec, hasRefreshToken: Boolean(current?.refreshToken) })
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


  // Fetches the user's current quota from the Cloud Code Assist API. Returns
  // the raw responses from fetchAvailableModels + retrieveUserQuotaSummary so
  // the caller (QuotaService) can parse them into display items. Both endpoints
  // are best-effort: if one 404s we still return the other. Only when both
  // fail do we surface a PROVIDER_UNAVAILABLE error.
  async getQuota(ctx: ProviderContext): Promise<RawQuotaResponse> {
    this.assertEndpointSafe(ctx)
    const { accessToken, bundle } = await this.resolveAuth(ctx)
    const projectId = await this.resolveProject(ctx, accessToken, bundle)
    const headers = await this.headers(ctx, accessToken)

    let models: RawQuotaResponse['models'] = {}
    let quotaSummary: RawQuotaResponse['quotaSummary']
    let modelsOk = false
    let summaryOk = false

    for (const base of this.baseUrlsToTry(ctx)) {
      if (!modelsOk) {
        try {
          const res = await this.fetcher(joinUrl(base, FETCH_MODELS_PATH), { method: 'POST', headers, body: '{}', signal: ctx.signal })
          if (res.ok) {
            const data = (await res.json()) as { payload?: { models?: RawQuotaResponse['models'] }; models?: RawQuotaResponse['models'] }
            models = data.payload?.models ?? data.models ?? {}
            modelsOk = true
          }
        } catch {
          // try next base url
        }
      }
      if (!summaryOk) {
        try {
          const res = await this.fetcher(joinUrl(base, QUOTA_SUMMARY_PATH), { method: 'POST', headers, body: JSON.stringify({ project: projectId }), signal: ctx.signal })
          if (res.ok) {
            quotaSummary = (await res.json()) as RawQuotaResponse['quotaSummary']
            summaryOk = true
          }
        } catch {
          // try next base url
        }
      }
      if (modelsOk && summaryOk) break
    }

    if (!modelsOk && !summaryOk) {
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Could not fetch Antigravity quota.', retryable: true })
    }
    return { models, quotaSummary }
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
    const { contents, systemInstruction } = toAntigravityContents(request.messages)
    // Diagnostic: log the request contents structure (roles + part keys only,
    // never content) to debug the tool-call round-trip 400. Remove once stable.
    this.log('request contents shape', {
      contents: contents.map((c) => ({ role: c.role, partKeys: c.parts.map((p) => Object.keys(p)) }))
    })
    const body = {
      project: projectId,
      requestId: id,
      model: request.model,
      userAgent: 'antigravity',
      requestType: 'agent',
      request: {
        contents,
        session_id: 'sess_' + randomUUID().slice(0, 8),
        systemInstruction: systemInstruction ?? { parts: [{ text: ANTIGRAVITY_SYSTEM_PROMPT }] },
        ...(request.tools && request.tools.length > 0 ? { tools: translateTools(request.tools) } : {}),
        ...(request.toolChoice ? { toolConfig: translateToolChoice(request.toolChoice) } : {}),
        generationConfig: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens && request.maxTokens > 0 ? { maxOutputTokens: request.maxTokens } : {})
        }
      }
    }

    // Try each base URL in order. The primary endpoint can intermittently 5xx;
    // falling back to the next base URL avoids surfacing a spurious
    // PROVIDER_UNAVAILABLE when a sibling endpoint is healthy.
    let lastErr: ProviderError | undefined
    for (const base of this.baseUrlsToTry(ctx)) {
      let res
      try {
        this.log('stream request', { base, model: request.model, projectId })
        res = await this.fetcher(joinUrl(base, STREAM_PATH), {
          method: 'POST',
          headers: await this.headers(ctx, accessToken),
          body: JSON.stringify(body),
          signal: ctx.signal
        })
      } catch {
        if (ctx.signal.aborted) throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
        this.logger.warn(`[antigravity] network error on ${base}, trying next base url`)
        lastErr = new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Request to provider failed.', retryable: true })
        continue
      }
      if (!res.ok) {
        lastErr = this.errorFromStatus(res.status)
        // Diagnostic: read the provider error body (may contain the exact
        // INVALID_ARGUMENT reason). Never logs credentials/tokens.
        let errBody = ''
        try { errBody = (await res.text()).slice(0, 2000) } catch { /* ignore */ }
        this.logger.warn(`[antigravity] non-ok status ${res.status} on ${base} (retryable=${lastErr.retryable}) body=${errBody}`)
        // Only fall back on retryable (5xx) failures; a 4xx is a client bug and
        // retrying another endpoint won't help.
        if (!lastErr.retryable) throw lastErr
        continue
      }

      const shouldStream = request.stream !== false
      const chunks: NormalizedChatChunk[] = []
      for await (const chunk of this.parseSse(res, ctx.signal)) chunks.push(chunk)
      this.log('stream complete', { base, chunkCount: chunks.length, finishReason: chunks.find((c) => c.kind === 'finish')?.finishReason })

      if (!shouldStream) {
        yield* this.asNonStreamingChunks(chunks)
        return
      }
      yield* chunks
      return
    }
    throw lastErr ?? new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Request to provider failed.', retryable: true })
  }

  private async resolveProject(ctx: ProviderContext, accessToken: string, bundle: OAuthTokenBundle | undefined): Promise<string> {
    try {
      const projectId = await resolveProjectId({
        accessToken,
        cachedProjectId: bundle?.projectId,
        baseUrls: this.baseUrlsToTry(ctx),
        fetcher: this.fetcher,
        logger: this.logger
      })
      this.log('project resolved', { projectId, cached: Boolean(bundle?.projectId) })
      if (this.tokenManager && ctx.credentialRef && !bundle?.projectId) {
        await this.tokenManager.setProjectId(ctx.credentialRef, projectId).catch(() => {})
      }
      return projectId
    } catch (err) {
      this.logger.error(`[antigravity] project resolution failed: ${err instanceof Error ? err.message : String(err)}`)
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
      let blockCount = 0
      while (!done) {
        const { value, done: stop } = await reader.read()
        done = stop
        // Normalize CRLF to LF so blocks split reliably on '\n\n' regardless of
        // whether the provider emits '\r\n\r\n' or '\n\n' as the SSE separator.
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          blockCount++
          for (const c of this.parseEventLines(block)) yield c
        }
      }
      this.log('sse stream ended', { blockCount, trailingBufferLen: buffer.length })
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
    let reasoning = ''
    let finishReason: string | undefined
    let usage: NormalizedChatChunk['usage'] | undefined
    const toolCalls: NormalizedChatChunk['toolCall'][] = []
    const extractUsage = (obj: unknown): NormalizedChatChunk['usage'] => {
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
      // Diagnostic: log the response structure (keys only, never content) so we
      // can see the real shape the provider returns. Remove once stable.
      this.log('sse block shape', { topKeys: Object.keys(parsed), responseKeys: Object.keys(response) })
      const candidates = (response['candidates'] as unknown[] | undefined) ?? [response]
      for (const c of candidates) {
        const cand = c as Record<string, unknown>
        if (typeof cand['finishReason'] === 'string') finishReason = cand['finishReason']
        const content = cand['content'] as Record<string, unknown> | undefined
        const parts = (content?.['parts'] as unknown[] | undefined) ?? []
        // Diagnostic: log candidate/part structure (keys + part types only,
        // never text content) to see the real shape. Remove once stable.
        this.log('sse candidate shape', {
          candKeys: Object.keys(cand),
          contentKeys: content ? Object.keys(content) : undefined,
          partCount: parts.length,
          partKeys: parts.map((p) => Object.keys(p as Record<string, unknown>))
        })
        for (const p of parts) {
          const part = p as Record<string, unknown>
          // Reasoning parts (thought: true) carry the model's chain-of-thought.
          // Surface them as reasoning_delta so the client can show them instead
          // of dropping them (which left gemini-2.5-flash with an empty stream).
          if (part['thought'] === true) {
            if (typeof part['text'] === 'string' && part['text']) reasoning += part['text']
            continue
          }
          if (typeof part['text'] === 'string' && part['text']) accumulated += part['text']
          // The model can respond with a function call (tool call) instead of
          // text. Emit it as a tool_call_delta so the client sees the call
          // rather than an empty completion. `args` is an object; serialize it.
          // The Gemini `thoughtSignature` (if present) is stashed in the
          // tool-call id so it survives the OpenAI round-trip and can be
          // re-attached when the client resends the call (see
          // encodeToolCallId / toAntigravityContents).
          const fc = part['functionCall'] as { name?: string; args?: Record<string, unknown> } | undefined
          if (fc && typeof fc.name === 'string') {
            const thoughtSignature = typeof part['thoughtSignature'] === 'string' ? part['thoughtSignature'] : undefined
            toolCalls.push({
              index: toolCalls.length,
              id: encodeToolCallId(toolCalls.length, thoughtSignature),
              name: fc.name,
              arguments: fc.args ? JSON.stringify(fc.args) : '{}'
            })
          }
        }
      }
      if (response['usageMetadata']) usage = extractUsage(response)
      if (reasoning) {
        this.log('sse reasoning_delta', { len: reasoning.length })
        yield { id: 'x', kind: 'reasoning_delta', delta: reasoning }
        reasoning = ''
      }
      if (accumulated) {
        this.log('sse content_delta', { len: accumulated.length })
        yield { id: 'x', kind: 'content_delta', delta: accumulated }
        accumulated = ''
      }
      for (const tc of toolCalls) {
        if (!tc) continue
        this.log('sse tool_call_delta', { name: tc.name })
        yield { id: 'x', kind: 'tool_call_delta', toolCall: tc }
      }
      toolCalls.length = 0
      // Only emit a terminal `finish` when the provider reports an actual
      // finishReason (STOP/MAX_TOKENS/...). Intermediate SSE blocks carry
      // usageMetadata but no finishReason; emitting `finish` for each of them
      // makes the gateway stop after the first token.
      if (finishReason) {
        this.log('sse finish', { finishReason, usage })
        yield { id: 'x', kind: 'finish', finishReason: mapFinishReason(finishReason), ...(usage ? { usage } : {}) }
        finishReason = undefined
        usage = undefined
      }
    }
    if (reasoning) yield { id: 'x', kind: 'reasoning_delta', delta: reasoning }
    if (accumulated) yield { id: 'x', kind: 'content_delta', delta: accumulated }
  }

  private *asNonStreamingChunks(chunks: NormalizedChatChunk[]): Iterable<NormalizedChatChunk> {
    const text = chunks.filter((c) => c.kind === 'content_delta').map((c) => c.delta ?? '').join('')
    const reasoning = chunks.filter((c) => c.kind === 'reasoning_delta').map((c) => c.delta ?? '').join('')
    if (reasoning) yield { id: 'x', kind: 'reasoning_delta', delta: reasoning }
    yield { id: 'x', kind: 'content_delta', delta: text }
    const finish = chunks.find((c) => c.kind === 'finish')
    yield { id: 'x', kind: 'finish', finishReason: finish?.finishReason ?? 'stop', usage: finish?.usage }
  }
}

export function createAntigravityAdapter(id?: string, opts?: AntigravityAdapterOptions): AntigravityAdapter {
  return new AntigravityAdapter(id, opts)
}
