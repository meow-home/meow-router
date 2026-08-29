// Server-Sent Events serialization for the gateway.
//
// Each normalized chunk is serialized to an OpenAI-compatible `data: {...}`
// line, terminated by `data: [DONE]`. Compatible with the OpenAI SDK.

import { randomUUID } from 'node:crypto'
import type { NormalizedChatChunk } from '@meow-gateway/provider-core'

export function createRequestId(): string {
  return randomUUID()
}

// Serialize a normalized chunk to an OpenAI-compatible SSE `data:` payload
// (without the trailing newline; the caller writes frames). Returns null for a
// chunk the client should ignore (e.g. a finish chunk with no finish_reason is
// still emitted but may carry usage).
export function chunkToSseData(chunk: NormalizedChatChunk): string {
  const baseId = chunk.id
  switch (chunk.kind) {
    case 'content_delta':
      return JSON.stringify({
        id: baseId,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null }]
      })
    case 'tool_call_delta':
      return JSON.stringify({
        id: baseId,
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: chunk.toolCall!.index,
                  id: chunk.toolCall!.id,
                  function: {
                    name: chunk.toolCall!.name,
                    arguments: chunk.toolCall!.arguments
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      })
    case 'finish':
      return JSON.stringify({
        id: baseId,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: chunk.finishReason ?? 'stop' }],
        ...(chunk.usage ? { usage: sseUsage(chunk.usage) } : {})
      })
    default:
      return ''
  }
}

function sseUsage(usage: { inputTokens: number; outputTokens: number; cachedTokens?: number }) {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedTokens ?? 0 }
  }
}
