export interface FetcherResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
  /**
   * Optional binary body reader. Required by adapters that must forward raw
   * bytes (e.g. an image referenced by URL that has to be inlined as base64 in
   * the provider request). `text()` cannot be used for that: decoding binary
   * as UTF-8 corrupts the image.
   */
  arrayBuffer?(): Promise<ArrayBuffer>
  /** Optional streaming body reader for SSE/NDJSON responses. */
  body?: ReadableStream<Uint8Array>
}

export interface FetcherInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  form?: Record<string, string>
  signal?: AbortSignal
  /**
   * Redirect policy. Defaults to the runtime's (`follow`). Callers that fetch
   * attacker-supplied URLs (e.g. image links in a chat request) pass `error`
   * so a redirect cannot bounce the request to a host the SSRF guard rejected.
   */
  redirect?: 'follow' | 'error' | 'manual'
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
      arrayBuffer: () => res.arrayBuffer(),
      body: (res.body as ReadableStream<Uint8Array> | null) ?? undefined
    }
  }
}
