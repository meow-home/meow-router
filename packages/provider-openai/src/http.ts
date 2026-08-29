// Injectable fetch so the adapter is testable without real network. The fetch
// signature mirrors the global `fetch` (WHATWG). `Fetcher` is injected at
// construction time; tests supply a deterministic mock.

export interface FetcherResponse {
  ok: boolean
  status: number
  headers: {
    get(name: string): string | null
  }
  text(): Promise<string>
  json(): Promise<unknown>
  body: unknown
}

export interface Fetcher {
  (url: string, init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  }): Promise<FetcherResponse>
}

// Default fetcher bound to the global `fetch` where available; otherwise throws
// a clear error (adapter requires a fetcher in non-browser/worker contexts).
export function defaultFetcher(): Fetcher {
  if (typeof fetch !== 'function') {
    throw new Error('No global fetch available; provide a Fetcher to the adapter.')
  }
  return fetch as unknown as Fetcher
}
