// Localhost HTTP gateway server.
//
// Binds ONLY to 127.0.0.1 (loopback), default port 8317. Never binds 0.0.0.0.
// Fully dependency-injected so tests run it against random ports with fakes.
//
// Routes:
//   GET  /health             -> status
//   GET  /v1/models          -> OpenAI-compatible model list (delegated to listModels)
//   POST /v1/chat/completions-> OpenAI-compatible chat (streaming + non-streaming)
//
// Every request carries a requestId included in logs and errors.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderContext,
  type NormalizedChatRequest
} from '@meow-gateway/provider-core'
import type { GatewayDependencies, GatewayUsage, RouteCandidate } from './types'
import { nullLogger } from './types'
import { toGatewayErrorBody, httpStatusFor } from './errors'
import { parseJsonBody, validateChatCompletionsBody, createBodyReader } from './validate'
import { chunkToSseData, createRequestId } from './sse'
import { checkAuth } from './auth'

export const DEFAULT_PORT = 8317
export const DEFAULT_HOST = '127.0.0.1'
export const GATEWAY_HOST = DEFAULT_HOST
export const GATEWAY_PORT = DEFAULT_PORT

export interface GatewayServerOptions {
  port?: number
  host?: string
  version?: string
  // Per-request hard timeout in ms. The provider request is aborted (-> the
  // adapter surfaces TIMEOUT) once this elapses. Defaults to 120_000.
  requestTimeoutMs?: number
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

export interface GatewayServer {
  start(): Promise<{ host: string; port: number }>
  stop(): Promise<void>
  getPort(): number
  listener(): Server
}

export function createGatewayServer(deps: GatewayDependencies, opts: GatewayServerOptions = {}): GatewayServer {
  const host = opts.host ?? DEFAULT_HOST
  const port = opts.port ?? DEFAULT_PORT
  const version = opts.version ?? '0.1.0'
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const logger = deps.logger ?? nullLogger

  let server: Server | undefined

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = createRequestId()
    const startedAt = Date.now()

    try {
      if (!isAllowedHost(req)) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify(toGatewayErrorBody(new Error('Forbidden'))))
        return
      }

      const url = new URL(req.url ?? '/', `http://${host}`)

      const policy = (await deps.getAuthPolicy?.()) ?? { enabled: false, key: null }
      const auth = checkAuth(
        {
          method: req.method ?? 'GET',
          pathname: url.pathname,
          authorization: req.headers.authorization
        },
        policy
      )
      if (!auth.ok) {
        res.writeHead(auth.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(auth.body))
        // Path and reason only: never the header, never the key.
        logger.warn('unauthorized', { requestId, path: url.pathname, reason: auth.reason })
        return
      }

      // GET /health
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', version, gateway: { running: true } }))
        logger.info('health ok', { requestId })
        return
      }

      // GET /v1/models
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const models = (await deps.listModels?.()) ?? []
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: models }))
        logger.info('models listed', { requestId, count: models.length })
        return
      }

      // POST /v1/chat/completions
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        await handleChatCompletions(req, res, deps, requestId, startedAt)
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(toGatewayErrorBody(new Error('Not found'))))
    } catch (err) {
      const status = err instanceof ProviderError ? httpStatusFor(err.type) : 500
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(toGatewayErrorBody(err)))
      logger.error('gateway error', { requestId, error: err instanceof Error ? err.message : String(err) })
    } finally {
      logger.info('request', { requestId, method: req.method, path: req.url, latencyMs: Date.now() - startedAt })
    }
  }

  async function handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse,
    deps: GatewayDependencies,
    requestId: string,
    startedAt: number
  ): Promise<void> {
    const bodyReader = createBodyReader()
    const raw = await bodyReader.read(req)
    const body = validateChatCompletionsBody(parseJsonBody(raw))

    // Resolve the ordered route list for the (virtual) model.
    const resolved = await deps.resolveModel(body.model)
    if (!resolved) {
      throw new ProviderError({ type: 'MODEL_NOT_FOUND', message: `Unknown model: ${body.model}`, retryable: false })
    }

    let routes: RouteCandidate[]
    if (deps.resolveRoutes) {
      const rl = await deps.resolveRoutes(body.model)
      routes = rl.routes.length > 0 ? rl.routes : [primaryRoute(resolved)]
    } else {
      routes = [primaryRoute(resolved)]
    }

    const normalized: NormalizedChatRequest = {
      model: routes[0].providerModelId,
      messages: body.messages.map((m) => ({
        role: m.role as NormalizedChatRequest['messages'][number]['role'],
        content: m.content,
        ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
        ...(m.tool_calls ? { toolCalls: m.tool_calls } : {})
      })),
      stream: body.stream ?? false,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.topP !== undefined ? { topP: body.topP } : {}),
      ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.toolChoice ? { toolChoice: body.toolChoice } : {}),
      ...(body.responseFormat ? { responseFormat: body.responseFormat } : {})
    }

    // Create an AbortController and tie it to the client connection so that a
    // disconnect cancels the upstream provider request (T305: abort propagation).
    const controller = new AbortController()
    const onClose = () => controller.abort()
    res.on('close', onClose)
    res.once('finish', () => res.off('close', onClose))

    // Hard per-request timeout: abort the provider request once it elapses, so
    // a hung provider cannot hold the client connection open indefinitely (T801).
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

    try {
      if (body.stream) {
        return await handleStreamRoutes(res, deps, routes, controller.signal, normalized, body.model, requestId, startedAt)
      }
      return await handleNonStreamRoutes(res, deps, routes, controller.signal, normalized, body.model, requestId, startedAt)
    } finally {
      clearTimeout(timeout)
    }
  }

  // Build a per-route context and validate credential existence.
  async function buildRouteContext(
    deps: GatewayDependencies,
    route: RouteCandidate,
    signal: AbortSignal,
    requestId: string
  ): Promise<{ ctx: ProviderContext; adapter: ProviderAdapter; resolvedModelId: string }> {
    const credential = await deps.getCredential(refFor(route.providerId))
    if (!credential) {
      throw new ProviderError({
        type: 'AUTH_ERROR',
        message: `No credential configured for provider ${route.providerId}`,
        retryable: false
      })
    }
    // providerId is the DB UUID (virtual_model.provider_id); the adapter
    // registry is keyed by provider TYPE. Fall back to providerId only so
    // callers that key providers by type (e.g. tests) keep working.
    const adapter = deps.registry.require(route.adapterId ?? route.providerId)
    const ctx: ProviderContext = {
      credentialRef: refFor(route.providerId),
      credential,
      ...(route.baseUrl ? { baseUrl: route.baseUrl } : {}),
      signal,
      requestId
    }
    return { ctx, adapter, resolvedModelId: route.providerModelId }
  }

  // Decide whether an error should trigger fallback to the next route.
  // Per T701 we only fall back on retryable failures, never on client/auth/model
  // errors or provider rejections.
  function isRetryable(err: unknown): boolean {
    return err instanceof ProviderError && err.retryable === true
  }

  // Streaming dispatch with fallback. Fallback only happens BEFORE any chunk is
  // written to the client; once a stream starts we commit to that route.
  async function handleStreamRoutes(
    res: ServerResponse,
    deps: GatewayDependencies,
    routes: RouteCandidate[],
    signal: AbortSignal,
    normalized: NormalizedChatRequest,
    virtualModelId: string,
    requestId: string,
    _startedAt: number
  ): Promise<void> {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })

    let lastErr: unknown
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]
      // If any chunk was already written we cannot fall back.
      if (res.writableEnded || resDestroyed(res)) break
      const attemptStart = Date.now()
      try {
        const { ctx, adapter } = await buildRouteContext(deps, route, signal, requestId)
        let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined
        let status: GatewayUsage['status'] = 'success'
        let started = false
        for await (const chunk of adapter.chat(ctx, { ...normalized, model: route.providerModelId })) {
          if (ctx.signal.aborted) {
            status = 'aborted'
            break
          }
          if (chunk.usage) usage = chunk.usage
          const payload = chunkToSseData(chunk)
          if (payload) {
            started = true
            res.write(`data: ${payload}\n\n`)
          }
          if (chunk.kind === 'finish') break
        }
        if (ctx.signal.aborted) status = 'aborted'
        if (!started) {
          // Nothing emitted and not aborted -> treat as success-so-far; write DONE.
          status = resDestroyed(res) ? status : 'success'
        }
        if (status === 'success' && !res.destroyed && !res.writableEnded) {
          res.write('data: [DONE]\n\n')
        }
        if (!res.destroyed && !res.writableEnded) {
          res.end()
        }
        await recordUsage(deps, {
          requestId,
          virtualModelId,
          providerId: route.providerId,
          providerModelId: route.providerModelId,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedTokens: usage?.cachedTokens ?? 0,
          latencyMs: Date.now() - attemptStart,
          status,
          routeAttempt: i
        })
        logger.info('stream route', { requestId, route: i, providerId: route.providerId, status })
        return
      } catch (err) {
        lastErr = err
        const code = err instanceof ProviderError ? err.type : 'STREAM_ERROR'
        // Only fall back on retryable failures; any emitted chunk prevents fallback.
        if (!isRetryable(err) || resDestroyed(res) || res.writableEnded) {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: toGatewayErrorBody(err).error })}\n\n`)
            res.write('data: [DONE]\n\n')
            res.end()
          }
          await recordUsage(deps, {
            requestId,
            virtualModelId,
            providerId: route.providerId,
            providerModelId: route.providerModelId,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            latencyMs: Date.now() - attemptStart,
            status: 'error',
            errorCode: code,
            routeAttempt: i
          })
          logger.info('stream route error', { requestId, route: i, providerId: route.providerId, code })
          return
        }
        // Retryable and nothing written: record the failed attempt, try next route.
        await recordUsage(deps, {
          requestId,
          virtualModelId,
          providerId: route.providerId,
          providerModelId: route.providerModelId,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          latencyMs: Date.now() - attemptStart,
          status: 'error',
          errorCode: code,
          routeAttempt: i
        })
        logger.warn('stream route fallback', { requestId, route: i, providerId: route.providerId, code })
      }
    }

    // All routes exhausted (or retryable failures with no fallback left).
    const err = lastErr ?? new ProviderError({ type: 'STREAM_ERROR', message: 'No route succeeded.', retryable: false })
    if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: toGatewayErrorBody(err).error })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }

  // Non-streaming dispatch with fallback. We buffer content and only write on
  // success so fallback can be clean before any bytes reach the client.
  async function handleNonStreamRoutes(
    res: ServerResponse,
    deps: GatewayDependencies,
    routes: RouteCandidate[],
    signal: AbortSignal,
    normalized: NormalizedChatRequest,
    virtualModelId: string,
    requestId: string,
    startedAt: number
  ): Promise<void> {
    let lastErr: unknown
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]
      const attemptStart = Date.now()
      try {
        const { ctx, adapter } = await buildRouteContext(deps, route, signal, requestId)
        let content = ''
        let finishReason: string | undefined
        let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined
        for await (const chunk of adapter.chat(ctx, { ...normalized, model: route.providerModelId })) {
          if (ctx.signal.aborted) break
          if (chunk.kind === 'content_delta' && chunk.delta) content += chunk.delta
          if (chunk.usage) usage = chunk.usage
          if (chunk.kind === 'finish') {
            finishReason = chunk.finishReason
            break
          }
        }
        if (ctx.signal.aborted) {
          await recordUsage(deps, {
            requestId,
            virtualModelId,
            providerId: route.providerId,
            providerModelId: route.providerModelId,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            cachedTokens: usage?.cachedTokens ?? 0,
            latencyMs: Date.now() - attemptStart,
            status: 'aborted',
            routeAttempt: i
          })
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: requestId,
            object: 'chat.completion',
            choices: [
              { index: 0, message: { role: 'assistant', content }, finish_reason: finishReason ?? 'stop' }
            ],
            ...(usage
              ? { usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } }
              : {})
          })
        )
        await recordUsage(deps, {
          requestId,
          virtualModelId,
          providerId: route.providerId,
          providerModelId: route.providerModelId,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedTokens: usage?.cachedTokens ?? 0,
          latencyMs: Date.now() - attemptStart,
          status: 'success',
          routeAttempt: i
        })
        logger.info('completion done', { requestId, route: i, providerId: route.providerId, latencyMs: Date.now() - startedAt })
        return
      } catch (err) {
        lastErr = err
        const code = err instanceof ProviderError ? err.type : 'INTERNAL_ERROR'
        if (!isRetryable(err)) {
          const status = err instanceof ProviderError ? httpStatusFor(err.type) : 500
          if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(toGatewayErrorBody(err)))
          await recordUsage(deps, {
            requestId,
            virtualModelId,
            providerId: route.providerId,
            providerModelId: route.providerModelId,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            latencyMs: Date.now() - attemptStart,
            status: 'error',
            errorCode: code,
            routeAttempt: i
          })
          logger.error('completion error', { requestId, route: i, error: err instanceof Error ? err.message : String(err) })
          return
        }
        await recordUsage(deps, {
          requestId,
          virtualModelId,
          providerId: route.providerId,
          providerModelId: route.providerModelId,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          latencyMs: Date.now() - attemptStart,
          status: 'error',
          errorCode: code,
          routeAttempt: i
        })
        logger.warn('completion fallback', { requestId, route: i, providerId: route.providerId, code })
      }
    }

    const err = lastErr ?? new ProviderError({ type: 'PROVIDER_UNAVAILABLE', message: 'All routes failed.', retryable: false })
    const status = err instanceof ProviderError ? httpStatusFor(err.type) : 500
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(toGatewayErrorBody(err)))
  }

  return {
    async start() {
      return new Promise((resolve, reject) => {
        server = createServer((req, res) => {
          handle(req, res).catch((err) => {
            logger.error('unhandled', { error: err instanceof Error ? err.message : String(err) })
            if (!res.headersSent) {
              res.writeHead(500, { 'content-type': 'application/json' })
            }
            res.end(JSON.stringify(toGatewayErrorBody(err)))
          })
        })
        server.on('error', (err) => reject(err))
        server.listen(port, host, () => {
          const addr = server!.address() as AddressInfo
          resolve({ host: addr.address, port: addr.port })
        })
      })
    },
    async stop() {
      return new Promise((resolve) => {
        if (!server) return resolve()
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    },
    getPort() {
      const addr = server?.address() as AddressInfo | undefined
      return addr ? addr.port : port
    },
    listener() {
      return server!
    }
  }
}

function primaryRoute(resolved: {
  providerId: string
  providerModelId: string
  baseUrl?: string
  adapterId?: string
}): RouteCandidate {
  return {
    providerId: resolved.providerId,
    providerModelId: resolved.providerModelId,
    ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
    ...(resolved.adapterId ? { adapterId: resolved.adapterId } : {})
  }
}

// Must stay identical to credentialRefFor() in provider/providerService.ts,
// which is what actually writes the secret. A ref invented here finds nothing
// and every chat request reports the provider as unconfigured.
function refFor(providerId: string): string {
  return `provider:${providerId}`
}

function resDestroyed(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded
}

function isAllowedHost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

async function recordUsage(deps: GatewayDependencies, usage: GatewayUsage): Promise<void> {
  await deps.recordUsage?.(usage)
}
