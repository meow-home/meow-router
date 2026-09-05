// Unit tests for the Anthropic Messages API compatibility layer.
// Pure functions: no HTTP, no Electron, no provider coupling.

import { describe, it, expect } from 'vitest'
import type { NormalizedChatChunk } from '@meow-gateway/provider-core'
import {
  validateAnthropicMessagesBody,
  anthropicToNormalized,
  anthropicSseFromChunks,
  anthropicNonStreamingResponse,
  anthropicStopReason
} from './anthropic'

describe('validateAnthropicMessagesBody', () => {
  it('accepts a valid body', () => {
    const body = validateAnthropicMessagesBody({
      model: 'meo-claude',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(body.model).toBe('meo-claude')
    expect(body.max_tokens).toBe(100)
  })

  it('rejects a missing model', () => {
    expect(() =>
      validateAnthropicMessagesBody({ max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] })
    ).toThrow(/model/)
  })

  it('rejects a missing or non-positive max_tokens', () => {
    expect(() =>
      validateAnthropicMessagesBody({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    ).toThrow(/max_tokens/)
    expect(() =>
      validateAnthropicMessagesBody({ model: 'm', max_tokens: 0, messages: [{ role: 'user', content: 'hi' }] })
    ).toThrow(/max_tokens/)
  })

  it('rejects an empty messages array', () => {
    expect(() =>
      validateAnthropicMessagesBody({ model: 'm', max_tokens: 10, messages: [] })
    ).toThrow(/messages/)
  })

  it('rejects an invalid role', () => {
    expect(() =>
      validateAnthropicMessagesBody({ model: 'm', max_tokens: 10, messages: [{ role: 'system', content: 'x' }] })
    ).toThrow(/role/)
  })

  it('rejects a non-boolean stream', () => {
    expect(() =>
      validateAnthropicMessagesBody({ model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'x' }], stream: 'yes' })
    ).toThrow(/stream/)
  })
})

describe('anthropicToNormalized', () => {
  it('maps a simple user message', () => {
    const req = anthropicToNormalized({
      model: 'm',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hello' }]
    })
    expect(req.model).toBe('m')
    expect(req.messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(req.stream).toBe(false)
  })

  it('maps a system prompt to a system message', () => {
    const req = anthropicToNormalized({
      model: 'm',
      max_tokens: 10,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(req.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
  })

  it('maps tool_result blocks to tool messages', () => {
    const req = anthropicToNormalized({
      model: 'm',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'sunny' }
          ]
        }
      ]
    })
    expect(req.messages).toEqual([{ role: 'tool', content: 'sunny', toolCallId: 'call_1' }])
  })

  it('maps assistant tool_use blocks to toolCalls', () => {
    const req = anthropicToNormalized({
      model: 'm',
      max_tokens: 10,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Hanoi' } }
          ]
        }
      ]
    })
    const assistant = req.messages[0]
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBe('Let me check.')
    expect(assistant.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Hanoi"}' } }
    ])
  })

  it('translates tools and tool_choice', () => {
    const req = anthropicToNormalized({
      model: 'm',
      max_tokens: 10,
      tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'get_weather' },
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(req.tools).toEqual([
      { type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } } }
    ])
    expect(req.toolChoice).toEqual({ type: 'function', function: { name: 'get_weather' } })
  })
})

describe('anthropicStopReason', () => {
  it('maps finish reasons', () => {
    expect(anthropicStopReason('stop')).toBe('end_turn')
    expect(anthropicStopReason('length')).toBe('max_tokens')
    expect(anthropicStopReason('tool_calls')).toBe('tool_use')
    expect(anthropicStopReason(undefined)).toBe('end_turn')
  })
})

describe('anthropicSseFromChunks', () => {
  async function collect(chunks: NormalizedChatChunk[], model = 'm'): Promise<Array<Record<string, unknown>>> {
    const frames: Array<Record<string, unknown>> = []
    async function* iter(): AsyncIterable<NormalizedChatChunk> {
      for (const c of chunks) yield c
    }
    for await (const f of anthropicSseFromChunks(iter(), model)) {
      frames.push(JSON.parse(f) as Record<string, unknown>)
    }
    return frames
  }

  it('emits the full event sequence for a text response', async () => {
    const chunks: NormalizedChatChunk[] = [
      { id: 'c1', kind: 'content_delta', delta: 'Hello' },
      { id: 'c1', kind: 'content_delta', delta: ' world' },
      { id: 'c1', kind: 'finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2 } }
    ]
    const frames = await collect(chunks)
    const types = frames.map((f) => f.type)
    expect(types).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop'
    ])
    expect(frames[0].message).toMatchObject({ role: 'assistant', model: 'm' })
    expect(frames[2].delta).toEqual({ type: 'text_delta', text: 'Hello' })
    expect(frames[3].delta).toEqual({ type: 'text_delta', text: ' world' })
    expect(frames[5].delta).toEqual({ stop_reason: 'end_turn', stop_sequence: null })
    expect(frames[5].usage).toEqual({ output_tokens: 2 })
  })

  it('emits tool_use blocks', async () => {
    const chunks: NormalizedChatChunk[] = [
      { id: 'c1', kind: 'tool_call_delta', toolCall: { index: 0, id: 'call_1', name: 'get_weather', arguments: '{"city":' } },
      { id: 'c1', kind: 'tool_call_delta', toolCall: { index: 0, arguments: '"Hanoi"}' } },
      { id: 'c1', kind: 'finish', finishReason: 'tool_calls' }
    ]
    const frames = await collect(chunks)
    const types = frames.map((f) => f.type)
    expect(types).toContain('content_block_start')
    const start = frames.find((f) => f.type === 'content_block_start')
    expect(start!.content_block).toMatchObject({ type: 'tool_use', id: 'call_1', name: 'get_weather' })
    const deltas = frames.filter((f) => f.type === 'content_block_delta')
    expect(deltas[0].delta).toEqual({ type: 'input_json_delta', partial_json: '{"city":' })
    expect(deltas[1].delta).toEqual({ type: 'input_json_delta', partial_json: '"Hanoi"}' })
    const messageDelta = frames.find((f) => f.type === 'message_delta')
    expect(messageDelta!.delta).toEqual({ stop_reason: 'tool_use', stop_sequence: null })
  })
})

describe('anthropicNonStreamingResponse', () => {
  it('builds a text response', async () => {
    const chunks: NormalizedChatChunk[] = [
      { id: 'c1', kind: 'content_delta', delta: 'Hello' },
      { id: 'c1', kind: 'finish', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2 } }
    ]
    async function* iter(): AsyncIterable<NormalizedChatChunk> {
      for (const c of chunks) yield c
    }
    const res = await anthropicNonStreamingResponse(iter(), 'm', 'req-1')
    expect(res).toMatchObject({
      id: 'req-1',
      type: 'message',
      role: 'assistant',
      model: 'm',
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 }
    })
    expect(res.content).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('builds a tool_use response', async () => {
    const chunks: NormalizedChatChunk[] = [
      { id: 'c1', kind: 'tool_call_delta', toolCall: { index: 0, id: 'call_1', name: 'get_weather', arguments: '{"city":"Hanoi"}' } },
      { id: 'c1', kind: 'finish', finishReason: 'tool_calls' }
    ]
    async function* iter(): AsyncIterable<NormalizedChatChunk> {
      for (const c of chunks) yield c
    }
    const res = await anthropicNonStreamingResponse(iter(), 'm', 'req-1')
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Hanoi' } }
    ])
    expect(res.stop_reason).toBe('tool_use')
  })
})
