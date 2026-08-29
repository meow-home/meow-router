import {
  ProviderError,
  assertSafeEndpoint,
  type ProviderAdapter,
  type ProviderContext,
  type ModelInfo,
  type CredentialCheckResult,
  type NormalizedChatRequest,
  type NormalizedChatChunk,
  type GatewayErrorType
} from '@meow-gateway/provider-core'
import { openaiCompatibleMetadata } from './metadata'
import { defaultFetcher, type Fetcher } from './http'

const DEFAULT_BASE_URL = openaiCompatibleMetadata.defaultBaseUrl

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

// Map an HTTP response to a normalized error. Never includes auth headers or
// raw secrets. The message is user-facing and safe.
function errorFromResponse(status: number, bodyText: string, signal?: AbortSignal): ProviderError {
  if (signal?.aborted) {
    return new ProviderError({ type: 'TIMEOUT', message: 'Request was aborted.', retryable: false })
  }
  let providerCode: string | undefined
  let message = bodyText.slice(0, 300) || 'Provider request failed.'
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; code?: string; type?: string } }
    if (parsed.error) {
      if (parsed.error.message) message = parsed.error.message
      providerCode = parsed.error.code ?? parsed.error.type
    }
  } catch {
    // fall back to raw text
  }

  let type: GatewayErrorType = 'INTERNAL_ERROR'
  let retryable = false
  let retryAfterMs: number | undefined
  if (status === 401 || status === 403) {
    type = 'AUTH_ERROR'
  } else if (status === 429) {
    type = 'RATE_LIMIT'
    retryable = true
  } else if (status >= 400 && status < 500) {
    type = status === 404 ? 'MODEL_NOT_FOUND' : status === 422 ? 'REQUEST_REJECTED' : 'CLIENT_ERROR'
  } else if (status >= 500) {
    type = 'PROVIDER_UNAVAILABLE'
    retryable = true
  }

  return new ProviderError({ type, message, status, providerCode, retryable, retryAfterMs })
}

class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string
  private readonly fetcher: Fetcher

  constructor(id: string = openaiCompatibleMetadata.id, fetcher?: Fetcher) {
    this.id = id
    this.fetcher = fetcher ?? defaultFetcher()
  }

  private resolveBaseUrl(ctx: ProviderContext): string {
    return ctx.baseUrl || DEFAULT_BASE_URL
  }

  // SSRF guard: a custom provider endpoint must not point at loopback, private,
  // link-local, or cloud metadata addresses (T801). Throws a clear error.
  private assertEndpointSafe(ctx: ProviderContext): void {
    const baseUrl = this.resolveBaseUrl(ctx)
    const result = assertSafeEndpoint(baseUrl)
    if (!result.ok) {
      throw new ProviderError({
        type: 'REQUEST_REJECTED',
        message: `Unsafe provider endpoint: ${result.reason}`,
        retryable: false
      })
    }
  }

  private authHeaders(ctx: ProviderContext): Record<string, string> {
    return ctx.credential
      ? { Authorization: `Bearer ${ctx.credential}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' }
  }

  async getModels(ctx: ProviderContext): Promise<ModelInfo[]> {
    this.assertEndpointSafe(ctx)
    const url = joinUrl(this.resolveBaseUrl(ctx), '/models')
    let res: Awaited<ReturnType<Fetcher>>
    try {
      res = await this.fetcher(url, { method: 'GET', headers: this.authHeaders(ctx), signal: ctx.signal })
    } catch {
      if (ctx.signal.aborted) {
        throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
      }
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Request to provider failed.', retryable: true })
    }
    if (!res.ok) {
      throw errorFromResponse(res.status, await res.text(), ctx.signal)
    }
    const data = (await res.json()) as { data?: Array<{ id: string; object?: string }> }
    const list = data.data ?? []
    return list.map((m) => ({
      id: m.id,
      providerModelId: m.id,
      displayName: m.id,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: false, structuredOutput: false }
    }))
  }

  async validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult> {
    if (!ctx.credential) {
      return { ok: false, message: 'No API key provided.' }
    }
    try {
      // Smallest safe request: list models. No prompts sent.
      await this.getModels(ctx)
      return { ok: true, message: 'Credentials valid.' }
    } catch (err) {
      if (err instanceof ProviderError && (err.type === 'AUTH_ERROR' || err.type === 'MODEL_NOT_FOUND')) {
        const e = err as ProviderError
        return { ok: e.type !== 'AUTH_ERROR', message: err.message }
      }
      return { ok: false, message: err instanceof ProviderError ? err.message : 'Validation failed.' }
    }
  }

  async *chat(
    ctx: ProviderContext,
    request: NormalizedChatRequest
  ): AsyncIterable<NormalizedChatChunk> {
    this.assertEndpointSafe(ctx)
    const url = joinUrl(this.resolveBaseUrl(ctx), '/chat/completions')
    // Translate the normalized request into an OpenAI-compatible payload.
    const body = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {})
      })),
      stream: request.stream ?? false,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {})
    }

    let res: Awaited<ReturnType<Fetcher>>
    try {
      res = await this.fetcher(url, {
        method: 'POST',
        headers: { ...this.authHeaders(ctx), Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: ctx.signal
      })
    } catch {
      if (ctx.signal.aborted) {
        throw new ProviderError({ type: 'TIMEOUT', message: 'Request aborted.', retryable: false })
      }
      throw new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'Request to provider failed.', retryable: true })
    }

    if (!res.ok) {
      throw errorFromResponse(res.status, await res.text(), ctx.signal)
    }

    if (request.stream) {
      yield* this.parseSseStream(res)
    } else {
      const data = (await res.json()) as {
        id?: string
        choices?: Array<{ message?: { content?: string; tool_calls?: unknown[]; role?: string }; finish_reason?: string }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
      }
      const id = data.id ?? 'chatcmpl'
      const choice = data.choices?.[0]
      const content = choice?.message?.content ?? ''
      if (content) {
        yield { id, kind: 'content_delta', delta: content }
      }
      yield {
        id,
        kind: 'finish',
        finishReason: choice?.finish_reason ?? 'stop',
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
              cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0
            }
          : undefined
      }
    }
  }

  private async *parseSseStream(
    res: Awaited<ReturnType<Fetcher>>
  ): AsyncIterable<NormalizedChatChunk> {
    const reader = (res.body as ReadableStream<Uint8Array> | undefined)?.getReader()
    if (!reader) {
      // Fallback: if the response body isn't a readable stream, read text and split.
      const text = await res.text()
      yield* this.parseSseText(text)
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false
    while (!done) {
      const { value, done: stop } = await reader.read()
      done = stop
      buffer += decoder.decode(value, { stream: !done })
      // process complete SSE event blocks
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const chunk of this.parseEventLines(block)) yield chunk
      }
    }
    if (buffer.trim()) {
      for (const chunk of this.parseEventLines(buffer)) yield chunk
    }
  }

  private async *parseSseText(text: string): AsyncIterable<NormalizedChatChunk> {
    for (const block of text.split('\n\n')) {
      for (const chunk of this.parseEventLines(block)) yield chunk
    }
  }

  private *parseEventLines(block: string): Iterable<NormalizedChatChunk> {
    const lines = block.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: {
        id?: string
        choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
      }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
      const id = parsed.id ?? 'chatcmpl'
      const choice = parsed.choices?.[0]
      if (choice?.delta?.content) {
        yield { id, kind: 'content_delta', delta: choice.delta.content }
      }
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          yield {
            id,
            kind: 'tool_call_delta',
            toolCall: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }
          }
        }
      }
      if (choice?.finish_reason) {
        yield {
          id,
          kind: 'finish',
          finishReason: choice.finish_reason,
          usage: parsed.usage
            ? {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
                cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0
              }
            : undefined
        }
      }
    }
  }
}

export function createOpenAICompatibleAdapter(
  id: string = openaiCompatibleMetadata.id,
  fetcher?: Fetcher
): ProviderAdapter {
  return new OpenAICompatibleAdapter(id, fetcher)
}
