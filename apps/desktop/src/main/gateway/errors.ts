// OpenAI-compatible error envelope for the gateway.
//
// Never return provider secrets or upstream authorization headers. `type` follows
// the OpenAI error type strings; `code` is a stable gateway code. Messages are
// user-facing and sanitized.

import { ProviderError, type GatewayErrorType } from '@meow-gateway/provider-core'

export interface GatewayErrorBody {
  error: {
    message: string
    type: string
    code: string
    param?: string | null
  }
}

export function httpStatusFor(type: GatewayErrorType): number {
  switch (type) {
    case 'AUTH_ERROR':
      return 401
    case 'RATE_LIMIT':
      return 429
    case 'MODEL_NOT_FOUND':
      return 404
    case 'REQUEST_REJECTED':
    case 'CLIENT_ERROR':
      return 400
    case 'TIMEOUT':
    case 'STREAM_ERROR':
      return 504
    case 'PROVIDER_UNAVAILABLE':
      return 503
    default:
      return 500
  }
}

export function gatewayErrorCode(type: GatewayErrorType): string {
  switch (type) {
    case 'AUTH_ERROR':
      return 'PROVIDER_AUTH_FAILED'
    case 'RATE_LIMIT':
      return 'RATE_LIMIT'
    case 'MODEL_NOT_FOUND':
      return 'MODEL_NOT_FOUND'
    case 'REQUEST_REJECTED':
      return 'REQUEST_REJECTED'
    case 'CLIENT_ERROR':
      return 'INVALID_REQUEST'
    case 'TIMEOUT':
      return 'REQUEST_TIMEOUT'
    case 'STREAM_ERROR':
      return 'STREAM_ERROR'
    case 'PROVIDER_UNAVAILABLE':
      return 'PROVIDER_UNAVAILABLE'
    default:
      return 'INTERNAL_ERROR'
  }
}

export function gatewayErrorTypeString(type: GatewayErrorType): string {
  switch (type) {
    case 'AUTH_ERROR':
      return 'authentication_error'
    case 'RATE_LIMIT':
      return 'rate_limit_error'
    case 'MODEL_NOT_FOUND':
      return 'model_not_found_error'
    case 'REQUEST_REJECTED':
      return 'invalid_request_error'
    case 'CLIENT_ERROR':
      return 'invalid_request_error'
    case 'TIMEOUT':
      return 'timeout_error'
    case 'STREAM_ERROR':
      return 'stream_error'
    case 'PROVIDER_UNAVAILABLE':
      return 'provider_unavailable_error'
    default:
      return 'api_error'
  }
}

export function toGatewayErrorBody(err: unknown): GatewayErrorBody {
  const isProviderError = err instanceof ProviderError
  const type: GatewayErrorType = isProviderError
    ? (err as ProviderError).type
    : 'INTERNAL_ERROR'
  const message = isProviderError ? (err as ProviderError).message : 'Internal gateway error.'
  return {
    error: {
      message,
      type: gatewayErrorTypeString(type),
      code: gatewayErrorCode(type)
    }
  }
}
