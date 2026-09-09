import {
  type ProviderAdapter,
  type ProviderContext,
  type NormalizedChatRequest,
  type NormalizedChatChunk,
  type ModelInfo,
  type CredentialCheckResult,
  ProviderError
} from '@meow-gateway/provider-core'
import { type Fetcher, defaultFetcher } from '@meow-gateway/oauth-core'
import { type OAuthTokenManager } from '@meow-gateway/oauth-core'
import { CODEX_ORIGINATOR_HEADER } from './metadata'

export interface CodexAdapterOptions {
  fetcher?: Fetcher
  tokenManager?: OAuthTokenManager
}

export type CodexAdapter = ProviderAdapter

/**
 * CodexAdapter handles OpenAI API calls via OAuth identity.
 * 1. Tries the modern OpenAI Responses API (/v1/responses).
 * 2. Falls back to standard Chat Completions API (/v1/chat/completions).
 * 3. Handles auth recovery via injected tokenManager.
 */
export function createCodexAdapter(
  id: string,
  options: CodexAdapterOptions = {}
): CodexAdapter {
  const fetcher = options.fetcher ?? defaultFetcher()
  const tokenManager = options.tokenManager

  const mapUsage = (u: any) => ({
    inputTokens: u?.input_tokens ?? u?.inputTokens ?? 0,
    outputTokens: u?.output_tokens ?? u?.outputTokens ?? 0,
    cachedTokens: u?.prompt_tokens ?? 0
  })

  const tryResponsesApi = async function* (
    ctx: ProviderContext,
    req: NormalizedChatRequest,
    headers: Record<string, string>
  ): AsyncGenerator<NormalizedChatChunk> {
    const res = await fetcher(`${ctx.baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: req.stream
      }),
      signal: ctx.signal
    })
    if (res.status === 404) throw new ProviderError({ type: 'MODEL_NOT_FOUND', message: 'Responses API not found' })
    if (res.status === 401) throw new ProviderError({ type: 'AUTH_ERROR', message: 'Unauthorized' })
    if (!res.ok) throw new ProviderError({ type: 'INTERNAL_ERROR', message: `Responses API failed: ${res.status}`, status: res.status })

    if (!req.stream) {
      const json = await res.json() as any
      const content = json.output ?? ''
      yield { id: 'x', kind: 'content_delta', delta: content }
      yield { id: 'x', kind: 'finish', usage: mapUsage(json.usage), finishReason: 'stop' }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) throw new ProviderError({ type: 'INTERNAL_ERROR', message: 'No response body' })
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          if (json.type === 'response.output_text.delta') {
            yield { id: 'x', kind: 'content_delta', delta: json.delta }
          } else if (json.type === 'response.completed') {
            yield { id: 'x', kind: 'finish', usage: mapUsage(json.response?.usage), finishReason: 'stop' }
          }
        } catch { /* ignore malformed SSE */ }
      }
    }
  }

  const tryChatCompletionsApi = async function* (
    ctx: ProviderContext,
    req: NormalizedChatRequest,
    headers: Record<string, string>
  ): AsyncGenerator<NormalizedChatChunk> {
    const res = await fetcher(`${ctx.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: req.stream
      }),
      signal: ctx.signal
    })
    if (res.status === 401) throw new ProviderError({ type: 'AUTH_ERROR', message: 'Unauthorized' })
    if (!res.ok) throw new ProviderError({ type: 'INTERNAL_ERROR', message: `Chat completions failed: ${res.status}`, status: res.status })

    if (!req.stream) {
      const json = await res.json() as any
      const content = json.choices?.[0]?.message?.content ?? ''
      yield { id: 'x', kind: 'content_delta', delta: content }
      yield { id: 'x', kind: 'finish', usage: mapUsage(json.usage), finishReason: json.choices?.[0]?.finish_reason ?? 'stop' }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) throw new ProviderError({ type: 'INTERNAL_ERROR', message: 'No response body' })
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield { id: 'x', kind: 'content_delta', delta }
          if (json.choices?.[0]?.finish_reason) {
            yield { id: 'x', kind: 'finish', usage: mapUsage(json.usage), finishReason: json.choices[0].finish_reason }
          }
        } catch { /* ignore malformed SSE */ }
      }
    }
  }

  return {
    id,
    async getModels(ctx: ProviderContext): Promise<ModelInfo[]> {
      const res = await fetcher(`${ctx.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${ctx.credential}` },
        signal: ctx.signal
      })
      if (!res.ok) return []
      const json = await res.json() as { data: { id: string; object: string }[] }
      return (json.data ?? []).map(m => ({
        id: m.id,
        providerModelId: m.id,
        displayName: m.id,
        capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: false }
      }))
    },

    async validateCredentials(ctx: ProviderContext): Promise<CredentialCheckResult> {
      try {
        if (!ctx.credential) {
          if (!tokenManager) throw new ProviderError({ type: 'AUTH_ERROR', message: 'No credential provided and no tokenManager available.' })
          const token = await tokenManager.getAccessToken(ctx.credentialRef)
          const res = await fetcher(`${ctx.baseUrl}/v1/models`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctx.signal
          })
          if (res.status === 401) throw new ProviderError({ type: 'AUTH_ERROR', message: 'Unauthorized' })
          if (!res.ok) throw new ProviderError({ type: 'INTERNAL_ERROR', message: `Validation failed: ${res.status}`, status: res.status })
        } else {
          const res = await fetcher(`${ctx.baseUrl}/v1/models`, {
            headers: { Authorization: `Bearer ${ctx.credential}` },
            signal: ctx.signal
          })
          if (res.status === 401) throw new ProviderError({ type: 'AUTH_ERROR', message: 'Unauthorized' })
          if (!res.ok) throw new ProviderError({ type: 'INTERNAL_ERROR', message: `Validation failed: ${res.status}`, status: res.status })
        }
        return { ok: true, message: 'Codex credentials valid.' }
      } catch (e) {
        if (e instanceof ProviderError) {
          return { ok: false, message: e.message }
        }
        return { ok: false, message: e instanceof Error ? e.message : 'Validation failed.' }
      }
    },

    async *chat(ctx: ProviderContext, req: NormalizedChatRequest): AsyncGenerator<NormalizedChatChunk> {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${ctx.credential}`,
        'originator': CODEX_ORIGINATOR_HEADER
      }

      try {
        yield* tryResponsesApi(ctx, req, headers)
      } catch (e) {
        const isNotFound = e && typeof e === 'object' && 'type' in e && (e as any).type === 'MODEL_NOT_FOUND'
        if (isNotFound) {
          yield* tryChatCompletionsApi(ctx, req, headers)
        } else {
          throw e
        }
      }
    }
  }
}
