import { describe, it, expect } from 'vitest'
import { resolveProjectId, cloudCodeAssistClientMetadata } from './project'
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

  it('sends a well-formed ClientMetadata body that the real Antigravity API accepts', async () => {
    let sentBody: unknown
    const fetcher: Fetcher = async (_url, init) => {
      sentBody = JSON.parse(init?.body as string)
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ project: { id: 'proj' } }) } as never
    }
    await resolveProjectId({ accessToken: 'AT', baseUrls: ['https://a.example.com'], fetcher })
    const body = sentBody as Record<string, unknown>
    const metadata = body.metadata as Record<string, unknown>
    // The real LoadCodeAssistRequest requires a valid ClientMetadata:
    // ideName/pluginType/ideVersion/platform, NOT `appVersion`.
    expect(metadata['ideName']).toBe('GEMINI_CLI')
    expect(metadata['pluginType']).toBe('GEMINI')
    expect(metadata['ideVersion']).toBeTypeOf('string')
    expect(metadata['platform']).toBeTypeOf('string')
    expect(metadata['appVersion']).toBeUndefined()
    expect(body['mode']).toBe('FULL_ELIGIBILITY_CHECK')
  })

  it('extracts the project id from cloudaicompanionProject (the real response field)', async () => {
    const id = await resolveProjectId({
      accessToken: 'AT',
      baseUrls: ['https://a.example.com'],
      fetcher: fetcherFor(200, { cloudaicompanionProject: 'proj-real' })
    })
    expect(id).toBe('proj-real')
  })

  it('throws when loadCodeAssist signals an unprovisioned account', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '', json: async () => ({ project: { id: '' } }) } as never)
    await expect(resolveProjectId({ accessToken: 'AT', baseUrls: ['https://a.example.com'], fetcher })).rejects.toThrow(/project/i)
  })

  it('builds a valid Cloud Code Assist ClientMetadata payload', () => {
    const md = cloudCodeAssistClientMetadata('9.9.9')
    expect(md.ideName).toBe('GEMINI_CLI')
    expect(md.pluginType).toBe('GEMINI')
    expect(md.platform).toMatch(/^(DARWIN|LINUX|WINDOWS)_/)
    expect(md.ideVersion).toBe('9.9.9')
  })
})
