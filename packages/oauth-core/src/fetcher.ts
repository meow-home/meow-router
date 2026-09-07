export interface FetcherResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
  /** Optional streaming body reader for SSE/NDJSON responses. */
  body?: ReadableStream<Uint8Array>
}

export interface FetcherInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  form?: Record<string, string>
  signal?: AbortSignal
}

export interface Fetcher {
  (url: string, init?: FetcherInit): Promise<FetcherResponse>
}

export function defaultFetcher(): Fetcher {
  if (typeof fetch !== 'function') {
    throw new Error('No global fetch available; provide a Fetcher.')
  }
  return async (url, init) => {
    const { form, ...rest } = init ?? {}
    let body: string | undefined = rest.body
    const headers = { ...(rest.headers ?? {}) }
    if (form) {
      body = new URLSearchParams(form).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    const res = await fetch(url, { ...rest, body, headers })
    return {
      ok: res.ok,
      status: res.status,
      headers: { get: (name) => res.headers.get(name) },
      text: () => res.text(),
      json: () => res.json(),
      body: (res.body as ReadableStream<Uint8Array> | null) ?? undefined
    }
  }
}
