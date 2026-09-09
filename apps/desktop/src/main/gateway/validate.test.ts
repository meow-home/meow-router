// Unit tests for the gateway request body reader (T801 body-size limit).
//
// Regression coverage for the "other side closed" bug: when a request body
// exceeds the limit the reader must NOT destroy the socket (which makes the
// client see a dead connection) — it must drain the remainder and reject with a
// readable 413 ProviderError so the server can send a proper JSON error.

import { describe, it, expect } from 'vitest'
import { ProviderError } from '@meow-gateway/provider-core'
import { createBodyReader } from './validate'

interface FakeReq {
  on(event: string, cb: (chunk?: Buffer) => void): FakeReq
  resume(): void
}

function createFakeReq(): {
  req: FakeReq
  emit: (event: string, chunk?: Buffer) => void
  wasResumed: () => boolean
} {
  const handlers: Record<string, Array<(chunk?: Buffer) => void>> = {}
  let resumed = false
  return {
    req: {
      on(event: string, cb: (chunk?: Buffer) => void) {
        ;(handlers[event] ??= []).push(cb)
        return this
      },
      resume() {
        resumed = true
      }
    },
    emit(event: string, chunk?: Buffer) {
      for (const cb of handlers[event] ?? []) cb(chunk)
    },
    wasResumed: () => resumed
  }
}

describe('createBodyReader', () => {
  it('resolves with the concatenated body when under the limit', async () => {
    const { req, emit } = createFakeReq()
    const reader = createBodyReader(1024)
    const promise = reader.read(req)
    emit('data', Buffer.from('{"model":'))
    emit('data', Buffer.from('"gpt-4o"}'))
    emit('end')
    await expect(promise).resolves.toBe('{"model":"gpt-4o"}')
  })

  it('rejects with a 413 ProviderError when the body exceeds the limit', async () => {
    const { req, emit } = createFakeReq()
    const reader = createBodyReader(16)
    const promise = reader.read(req)
    emit('data', Buffer.from('x'.repeat(64)))
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).type).toBe('CLIENT_ERROR')
    expect((err as ProviderError).status).toBe(413)
    expect((err as ProviderError).message).toContain('size limit')
  })

  it('drains the remainder instead of destroying the socket on overflow', async () => {
    const { req, emit, wasResumed } = createFakeReq()
    const reader = createBodyReader(16)
    const promise = reader.read(req)
    emit('data', Buffer.from('x'.repeat(64)))
    // Remaining chunks keep arriving after the overflow; they must be ignored
    // (drained) and must not throw or resolve.
    emit('data', Buffer.from('y'.repeat(64)))
    emit('end')
    await expect(promise).rejects.toBeInstanceOf(ProviderError)
    expect(wasResumed()).toBe(true)
  })
})
