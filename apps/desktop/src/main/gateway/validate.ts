// Lightweight request validation for the OpenAI-compatible gateway.
// No schema library dependency: just explicit, defensive checks.
//
// Validation is permissive for provider-agnostic fields (temperature, top_p,
// max_tokens, tools, tool_choice, response_format) and strict on the fields the
// gateway MUST understand (model must be a string, messages must be an array).

import { ProviderError } from '@meow-gateway/provider-core'

export interface ChatCompletionsBody {
  model: string
  messages: Array<{ role: string; content: unknown; tool_call_id?: string; tool_calls?: unknown[] }>
  temperature?: number
  topP?: number
  maxTokens?: number
  stream?: boolean
  tools?: unknown[]
  toolChoice?: unknown
  responseFormat?: unknown
}

const MAX_BODY_BYTES = 256 * 1024 // 256 KiB

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function invalidRequest(msg: string): ProviderError {
  return new ProviderError({ type: 'CLIENT_ERROR', message: msg, retryable: false })
}

export function parseJsonBody(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw invalidRequest('Malformed JSON body.')
  }
}

export function validateChatCompletionsBody(body: unknown): ChatCompletionsBody {
  if (!isObject(body)) throw invalidRequest('Request body must be an object.')

  const model = body['model']
  if (typeof model !== 'string' || model.length === 0) {
    throw invalidRequest('`model` is required and must be a non-empty string.')
  }

  const messages = body['messages']
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalidRequest('`messages` is required and must be a non-empty array.')
  }
  for (const m of messages) {
    if (!isObject(m) || typeof m['role'] !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(m['role'])) {
      throw invalidRequest('Each message must have a valid role.')
    }
  }

  const stream = body['stream']
  if (stream !== undefined && typeof stream !== 'boolean') {
    throw invalidRequest('`stream` must be a boolean.')
  }

  const temperature = body['temperature']
  const topP = body['top_p']
  const maxTokens = body['max_tokens']
  const tools = body['tools']
  const toolChoice = body['tool_choice']
  const responseFormat = body['response_format']

  const out: ChatCompletionsBody = {
    model,
    messages: messages as ChatCompletionsBody['messages']
  }
  if (typeof temperature === 'number') out.temperature = temperature
  if (typeof topP === 'number') out.topP = topP
  if (typeof maxTokens === 'number') out.maxTokens = maxTokens
  if (stream !== undefined) out.stream = stream
  if (Array.isArray(tools)) out.tools = tools
  if (toolChoice !== undefined) out.toolChoice = toolChoice
  if (responseFormat !== undefined) out.responseFormat = responseFormat

  return out
}

export function createBodyReader(maxBytes: number = MAX_BODY_BYTES): {
  read(req: unknown): Promise<string>
} {
  return {
    read(req: { on(event: string, cb: (chunk: Buffer) => void): void; destroy(err?: Error): void }) {
      return new Promise<string>((resolve, reject) => {
        let data = ''
        let size = 0
        req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            req.destroy(new Error('Payload too large'))
            reject(invalidRequest('Request body exceeds the size limit.'))
            return
          }
          data += chunk.toString('utf8')
        })
        req.on('end', () => resolve(data))
        req.on('error', (e) => reject(e))
      })
    }
  }
}
