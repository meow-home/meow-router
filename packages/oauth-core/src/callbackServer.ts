import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

class CallbackError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'CallbackError'
  }
}

const SUCCESS_HTML = `<!doctype html><html><body><h2>Authentication complete.</h2><p>You can close this window and return to Meow.</p></body></html>`

export interface CallbackServerOptions {
  host?: string
  state: string
  /** URL path the callback is expected on, e.g. "/oauth-callback". */
  callbackPath?: string
  /** ms before the server self-closes waiting for a callback. */
  timeoutMs?: number
  onErrorHtml?: (err: { code: string; message: string }) => string
}

export interface CallbackResult {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

export class CallbackServer {
  private server?: Server
  private readonly host: string
  private readonly callbackPath: string
  private readonly state: string
  private readonly timeoutMs: number
  private readonly onErrorHtml?: (err: { code: string; message: string }) => string

  constructor(options: CallbackServerOptions) {
    this.host = options.host ?? '127.0.0.1'
    this.callbackPath = options.callbackPath ?? '/oauth-callback'
    this.state = options.state
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.onErrorHtml = options.onErrorHtml
  }

  async start(): Promise<{ port: number; redirectUri: string; wait(): Promise<CallbackResult & { code: string }> }> {
    if (this.server) throw new CallbackError('Callback server already running.', 'already_running')
    const server = createServer()
    const results = new Map<string, CallbackResult>()

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${this.host}:0`}`)
      if (url.pathname !== this.callbackPath) {
        res.writeHead(404).end('Not found')
        return
      }
      const result: CallbackResult = {
        code: url.searchParams.get('code') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
        error: url.searchParams.get('error') ?? undefined,
        errorDescription: url.searchParams.get('error_description') ?? undefined
      }
      results.set('last', result)
      if (result.error && this.onErrorHtml) {
        res.writeHead(200).end(this.onErrorHtml({ code: result.error, message: result.errorDescription ?? result.error }))
      } else {
        res.writeHead(200).end(SUCCESS_HTML)
      }
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, this.host, () => resolve())
    })

    const address = server.address() as AddressInfo
    const port = address.port

    const wait = (): Promise<CallbackResult & { code: string }> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.close().catch(() => undefined)
          reject(new CallbackError('Timed out waiting for the OAuth callback.', 'timeout'))
        }, this.timeoutMs)
        const poll = setInterval(() => {
          const r = results.get('last')
          if (!r) return
          clearInterval(poll)
          clearTimeout(timer)
          if (r.error) {
            this.close().catch(() => undefined)
            reject(new CallbackError(r.errorDescription ?? r.error, r.error))
            return
          }
          if (!r.code) return // waiting on a non-code result
          if (r.state !== this.state) {
            this.close().catch(() => undefined)
            reject(new CallbackError('State mismatch.', 'state_mismatch'))
            return
          }
          resolve(r as CallbackResult & { code: string })
        }, 50)
      })

    this.server = server
    return { port, redirectUri: `http://${this.host}:${port}${this.callbackPath}`, wait }
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
}
