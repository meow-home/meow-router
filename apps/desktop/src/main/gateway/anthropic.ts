// Anthropic Messages API compatibility layer.
//
// Claude Code (and other Anthropic-native clients) talk to the gateway over
// `POST /v1/messages` with the Anthropic Messages wire format. This module
// translates between that format and the provider-neutral NormalizedChatRequest
// / NormalizedChatChunk contract used by the gateway's provider adapters.
//
// It is a pure module: no HTTP, no Electron, no provider coupling. Everything
// here is unit-testable offline.

import { ProviderError } from '@meow-gateway/provider-core'
import type {
  NormalizedChatRequest,
  NormalizedChatChunk,
  NormalizedMessage,
  UsageExtraction
} from '@meow-gateway/provider-core'

// --- Request types ----------------------------------------------------------

export interface AnthropicContentBlock {
  type: string
  text?: string
  tool_use_id?: string
  content?: unknown
  id?: string
  name?: string
  input?: unknown
}

export interface AnthropicMessage {
  role: string
  content: unknown
}

export interface AnthropicMessagesBody {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string | AnthropicContentBlock[]
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: unknown[]
  tool_choice?: unknown
  stop_sequences?: string[]
}

// --- Validation -------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function invalidRequest(msg: string): ProviderError {
  return new ProviderError({ type: 'CLIENT_ERROR', message: msg, retryable: false })
}

export function parseAnthropicMessagesBody(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw invalidRequest('Malformed JSON body.')
  }
}

export function validateAnthropicMessagesBody(body: unknown): AnthropicMessagesBody {
  if (!isObject(body)) throw invalidRequest('Request body must be an object.')

  const model = body['model']
  if (typeof model !== 'string' || model.length === 0) {
    throw invalidRequest('`model` is required and must be a non-empty string.')
  }

  const maxTokens = body['max_tokens']
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw invalidRequest('`max_tokens` is required and must be a positive number.')
  }

  const messages = body['messages']
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalidRequest('`messages` is required and must be a non-empty array.')
  }
  for (const m of messages) {
    if (!isObject(m) || typeof m['role'] !== 'string' || !['user', 'assistant'].includes(m['role'])) {
      throw invalidRequest('Each message must have a valid role (user or assistant).')
    }
  }

  const stream = body['stream']
  if (stream !== undefined && typeof stream !== 'boolean') {
    throw invalidRequest('`stream` must be a boolean.')
  }

  const out: AnthropicMessagesBody = {
    model,
    max_tokens: maxTokens,
    messages: messages as AnthropicMessage[]
  }
  if (typeof body['system'] === 'string' || Array.isArray(body['system'])) out.system = body['system'] as AnthropicMessagesBody['system']
  if (typeof body['temperature'] === 'number') out.temperature = body['temperature']
  if (typeof body['top_p'] === 'number') out.top_p = body['top_p']
  if (stream !== undefined) out.stream = stream
  if (Array.isArray(body['tools'])) out.tools = body['tools']
  if (body['tool_choice'] !== undefined) out.tool_choice = body['tool_choice']
  if (Array.isArray(body['stop_sequences'])) out.stop_sequences = body['stop_sequences']

  return out
}

// --- Request translation: Anthropic -> Normalized --------------------------

function isBlockArray(v: unknown): v is AnthropicContentBlock[] {
  return Array.isArray(v)
}

function blockText(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

// Anthropic tool_choice -> OpenAI tool_choice.
function translateToolChoice(tc: unknown): unknown {
  if (typeof tc === 'string') return tc
  if (!isObject(tc)) return tc
  const type = tc['type']
  if (type === 'auto') return 'auto'
  if (type === 'none') return 'none'
  if (type === 'any') return 'required'
  if (type === 'tool' && typeof tc['name'] === 'string') {
    return { type: 'function', function: { name: tc['name'] } }
  }
  return tc
}

// Anthropic tools -> OpenAI tools.
function translateTools(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    if (!isObject(t)) return t
    return {
      type: 'function',
      function: {
        name: t['name'],
        description: t['description'],
        parameters: t['input_schema']
      }
    }
  })
}

export function anthropicToNormalized(body: AnthropicMessagesBody): NormalizedChatRequest {
  const messages: NormalizedMessage[] = []

  if (body.system) {
    const systemText =
      typeof body.system === 'string' ? body.system : blockText(body.system as AnthropicContentBlock[])
    if (systemText) messages.push({ role: 'system', content: systemText })
  }

  for (const m of body.messages) {
    if (m.role === 'user') {
      if (isBlockArray(m.content)) {
        const toolResults = m.content.filter((b) => b.type === 'tool_result')
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            messages.push({ role: 'tool', content: tr.content, toolCallId: tr.tool_use_id })
          }
          continue
        }
        const text = blockText(m.content)
        messages.push({ role: 'user', content: text })
        continue
      }
      messages.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (isBlockArray(m.content)) {
        const text = blockText(m.content)
        const toolUses = m.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
          }))
        messages.push({
          role: 'assistant',
          content: text,
          ...(toolUses.length > 0 ? { toolCalls: toolUses } : {})
        })
        continue
      }
      messages.push({ role: 'assistant', content: m.content })
    }
  }

  const out: NormalizedChatRequest = {
    model: body.model,
    messages,
    stream: body.stream ?? false,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { topP: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { maxTokens: body.max_tokens } : {}),
    ...(body.tools ? { tools: translateTools(body.tools) } : {}),
    ...(body.tool_choice !== undefined ? { toolChoice: translateToolChoice(body.tool_choice) } : {})
  }
  return out
}

// --- Response serialization -------------------------------------------------

// Map an OpenAI-style finish reason to an Anthropic stop_reason.
export function anthropicStopReason(finishReason: string | undefined): string {
  switch (finishReason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'stop':
    default:
      return 'end_turn'
  }
}

// Serialize a normalized chunk stream into Anthropic Messages SSE `data:`
// frames (without the trailing newline; the caller writes frames). Emits the
// full event sequence: message_start, content_block_start/delta/stop,
// message_delta, message_stop.
export async function* anthropicSseFromChunks(
  chunks: AsyncIterable<NormalizedChatChunk>,
  model: string
): AsyncIterable<string> {
  let messageStarted = false
  let blockIndex = 0
  let currentBlock: 'text' | 'tool_use' | null = null
  let currentToolIndex = -1
  let stopReason: string | undefined
  let usage: UsageExtraction | undefined

  for await (const chunk of chunks) {
    if (!messageStarted) {
      messageStarted = true
      yield JSON.stringify({
        type: 'message_start',
        message: {
          id: chunk.id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })
    }

    switch (chunk.kind) {
      case 'content_delta': {
        if (currentBlock !== 'text') {
          if (currentBlock) {
            yield JSON.stringify({ type: 'content_block_stop', index: blockIndex })
            blockIndex++
          }
          currentBlock = 'text'
          currentToolIndex = -1
          yield JSON.stringify({
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text', text: '' }
          })
        }
        yield JSON.stringify({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: chunk.delta ?? '' }
        })
        break
      }
      case 'tool_call_delta': {
        const tc = chunk.toolCall!
        const toolIndex = tc.index ?? 0
        if (currentBlock !== 'tool_use' || toolIndex !== currentToolIndex) {
          if (currentBlock) {
            yield JSON.stringify({ type: 'content_block_stop', index: blockIndex })
            blockIndex++
          }
          currentBlock = 'tool_use'
          currentToolIndex = toolIndex
          yield JSON.stringify({
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} }
          })
        }
        yield JSON.stringify({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: tc.arguments ?? '' }
        })
        break
      }
      case 'finish': {
        if (chunk.usage) usage = chunk.usage
        stopReason = chunk.finishReason
        break
      }
    }
  }

  if (currentBlock) {
    yield JSON.stringify({ type: 'content_block_stop', index: blockIndex })
  }
  yield JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: anthropicStopReason(stopReason), stop_sequence: null },
    usage: { output_tokens: usage?.outputTokens ?? 0 }
  })
  yield JSON.stringify({ type: 'message_stop' })
}

// Build a non-streaming Anthropic Messages JSON response from a normalized
// chunk stream.
export async function anthropicNonStreamingResponse(
  chunks: AsyncIterable<NormalizedChatChunk>,
  model: string,
  requestId: string
): Promise<Record<string, unknown>> {
  let text = ''
  const toolUses: Array<{ index: number; id?: string; name?: string; args: string }> = []
  let stopReason: string | undefined
  let usage: UsageExtraction | undefined

  for await (const chunk of chunks) {
    switch (chunk.kind) {
      case 'content_delta':
        if (chunk.delta) text += chunk.delta
        break
      case 'tool_call_delta': {
        const tc = chunk.toolCall!
        const idx = tc.index ?? 0
        const existing = toolUses.find((t) => t.index === idx)
        if (existing) {
          if (tc.arguments) existing.args += tc.arguments
          if (tc.id) existing.id = tc.id
          if (tc.name) existing.name = tc.name
        } else {
          toolUses.push({ index: idx, id: tc.id, name: tc.name, args: tc.arguments ?? '' })
        }
        break
      }
      case 'finish':
        if (chunk.usage) usage = chunk.usage
        stopReason = chunk.finishReason
        break
    }
  }

  const content: unknown[] = []
  if (text) content.push({ type: 'text', text })
  for (const t of toolUses) {
    let input: unknown = {}
    try {
      input = t.args ? JSON.parse(t.args) : {}
    } catch {
      input = {}
    }
    content.push({ type: 'tool_use', id: t.id, name: t.name, input })
  }

  return {
    id: requestId,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: anthropicStopReason(stopReason),
    stop_sequence: null,
    usage: {
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0
    }
  }
}
