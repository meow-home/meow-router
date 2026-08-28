import { describe, it, expect } from 'vitest'
import { ERROR_TYPES, type GatewayErrorType } from './types'

describe('provider-core types', () => {
  it('exposes the normalized gateway error taxonomy', () => {
    expect(ERROR_TYPES).toContain('RATE_LIMIT')
    expect(ERROR_TYPES).toContain('AUTH_ERROR')
  })

  it('GatewayErrorType unions the ERROR_TYPES values', () => {
    const sample: GatewayErrorType = 'TIMEOUT'
    expect(ERROR_TYPES).toContain(sample)
  })
})
