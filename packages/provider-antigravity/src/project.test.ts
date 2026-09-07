import { describe, it, expect } from 'vitest'
import { resolveProjectId } from './project'
import type { Fetcher } from '@meow-gateway/oauth-core'

function fetcherFor(status: number, body: unknown): Fetcher {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
    json: async () => body
  })
}

describe('resolveProjectId', () => {
  it('returns the cached project id immediately', async () => {
    const id = await resolveProjectId({
      accessToken: 'AT',
      cachedProjectId: 'proj-cached',
      baseUrls: ['https://a.example.com'],
      fetcher: fetcherFor(200, {})
    })
    expect(id).toBe('proj-cached')
  })

  it('calls loadCodeAssist and extracts project.id from payload', async () => {
    const calls: string[] = []
    const urls = ['https://a.example.com', 'https://b.example.com']
    const fetcher: Fetcher = async (url, init) => {
      calls.push(url)
      if (url.includes('a.example.com')) {
        return { ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({}) } as never
      }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ project: { id: 'proj-2' } }), form: init?.form } as never
    }
    const id = await resolveProjectId({ accessToken: 'AT', baseUrls: urls, fetcher })
    expect(id).toBe('proj-2')
    expect(calls[0]).toContain('loadCodeAssist')
    expect(calls[1]).toContain('loadCodeAssist')
  })

  it('throws when loadCodeAssist signals an unprovisioned account', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ project: { id: '' } }) } as never)
    await expect(resolveProjectId({ accessToken: 'AT', baseUrls: ['https://a.example.com'], fetcher })).rejects.toThrow(/project/i)
  })
})
