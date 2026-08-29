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
import type { GatewayDependencies, GatewayUsage } from './types'
import { nullLogger } from './types'
import { toGatewayErrorBody, httpStatusFor } from './errors'
import { parseJsonBody, validateChatCompletionsBody, createBodyReader } from './validate'
import { chunkToSseData, createRequestId } from './sse'

export const DEFAULT_PORT = 8317
export const DEFAULT_HOST = '127.0.0.1'
export const GATEWAY_HOST = DEFAULT_HOST
export const GATEWAY_PORT = DEFAULT_PORT

export interface GatewayServerOptions {
  port?: number
  host?: string
  version?: string
}

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

    // Resolve the (virtual) model.
    const resolved = await deps.resolveModel(body.model)
    if (!resolved) {
      throw new ProviderError({ type: 'MODEL_NOT_FOUND', message: `Unknown model: ${body.model}`, retryable: false })
    }

    // Resolve the credential (main-process only).
    const credential = await deps.getCredential(refFor(resolved.providerId))
    if (!credential) {
      throw new ProviderError({
        type: 'AUTH_ERROR',
        message: `No credential configured for provider ${resolved.providerId}`,
        retryable: false
      })
    }

    const adapter = deps.registry.require(resolved.providerId)

    // Create an AbortController and tie it to the client connection so that a
    // disconnect cancels the upstream provider request (T305: abort propagation).
    const controller = new AbortController()
    const onClose = () => controller.abort()
    res.on('close', onClose)
    res.once('finish', () => res.off('close', onClose))

    const ctx: ProviderContext = {
      credentialRef: refFor(resolved.providerId),
      credential,
      signal: controller.signal,
      requestId
    }

    const normalized: NormalizedChatRequest = {
      model: resolved.providerModelId,
      messages: body.messages.map((m) => ({
        role: m.role as NormalizedChatRequest['messages'][number]['role'],
        content: m.content,
        ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {})
      })),
      stream: body.stream ?? false,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.topP !== undefined ? { topP: body.topP } : {}),
      ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.toolChoice ? { toolChoice: body.toolChoice } : {}),
      ...(body.responseFormat ? { responseFormat: body.responseFormat } : {})
    }

    if (body.stream) {
      return handleStream(res, deps, adapter, ctx, normalized, body.model, resolved, requestId, startedAt)
    }
    return handleNonStream(res, deps, adapter, ctx, normalized, body.model, resolved, requestId, startedAt)
  }

  async function handleStream(
    res: ServerResponse,
    deps: GatewayDependencies,
    adapter: ProviderAdapter,
    ctx: ProviderContext,
    normalized: NormalizedChatRequest,
    virtualModelId: string,
    resolved: NonNullable<Awaited<ReturnType<GatewayDependencies['resolveModel']>>>,
    requestId: string,
    startedAt: number
  ): Promise<void> {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })

    let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined
    let status: GatewayUsage['status'] = 'success'
    let errorCode: string | undefined

    try {
      for await (const chunk of adapter.chat(ctx, normalized)) {
        if (ctx.signal.aborted) {
          status = 'aborted'
          break
        }
        if (chunk.usage) usage = chunk.usage
        const payload = chunkToSseData(chunk)
        if (payload) res.write(`data: ${payload}\n\n`)
        if (chunk.kind === 'finish') break
      }
      // A client disconnect during a suspended generator yields no exception but
      // the signal is aborted; reflect that in the recorded status.
      if (ctx.signal.aborted) status = 'aborted'
      if (status === 'success') {
        res.write('data: [DONE]\n\n')
      }
    } catch (err) {
      status = 'error'
      errorCode = err instanceof ProviderError ? err.type : 'STREAM_ERROR'
      if (!res.destroyed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: toGatewayErrorBody(err).error })}\n\n`)
        res.write('data: [DONE]\n\n')
      }
    } finally {
      if (!res.destroyed && !res.writableEnded) {
        res.end()
      }
      await recordUsage(deps, {
        requestId,
        virtualModelId,
        providerId: resolved.providerId,
        providerModelId: resolved.providerModelId,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cachedTokens: usage?.cachedTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        status,
        errorCode
      })
      logger.info('stream completed', { requestId, status, errorCode })
    }
  }

  async function handleNonStream(
    res: ServerResponse,
    deps: GatewayDependencies,
    adapter: ProviderAdapter,
    ctx: ProviderContext,
    normalized: NormalizedChatRequest,
    virtualModelId: string,
    resolved: NonNullable<Awaited<ReturnType<GatewayDependencies['resolveModel']>>>,
    requestId: string,
    startedAt: number
  ): Promise<void> {
    let content = ''
    let finishReason: string | undefined
    let usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined

    try {
      for await (const chunk of adapter.chat(ctx, normalized)) {
        if (chunk.kind === 'content_delta' && chunk.delta) content += chunk.delta
        if (chunk.usage) usage = chunk.usage
        if (chunk.kind === 'finish') {
          finishReason = chunk.finishReason
          break
        }
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
        providerId: resolved.providerId,
        providerModelId: resolved.providerModelId,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cachedTokens: usage?.cachedTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        status: 'success'
      })
      logger.info('completion done', { requestId, latencyMs: Date.now() - startedAt })
    } catch (err) {
      const status = err instanceof ProviderError ? httpStatusFor(err.type) : 500
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(toGatewayErrorBody(err)))
      await recordUsage(deps, {
        requestId,
        virtualModelId,
        providerId: resolved.providerId,
        providerModelId: resolved.providerModelId,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorCode: err instanceof ProviderError ? err.type : 'INTERNAL_ERROR'
      })
      logger.error('completion error', { requestId, error: err instanceof Error ? err.message : String(err) })
    }
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

function refFor(providerId: string): string {
  return `provider.${providerId}.primary`
}

function isAllowedHost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

async function recordUsage(deps: GatewayDependencies, usage: GatewayUsage): Promise<void> {
  await deps.recordUsage?.(usage)
}
