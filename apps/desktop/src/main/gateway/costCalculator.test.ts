// Deterministic unit tests for cost estimation (T501). Pricing is data; unknown
// pricing yields null, never a fabricated number.

import { describe, it, expect } from 'vitest'
import { estimateCost } from './costCalculator'

describe('estimateCost', () => {
  it('computes cost from per-1M-token pricing', () => {
    // $2 / 1M input, $8 / 1M output
    const est = estimateCost(
      { inputPricePerMillion: 2, outputPricePerMillion: 8 },
      { inputTokens: 1000, outputTokens: 500, cachedTokens: 0 }
    )
    expect(est).toBeTruthy()
    expect(est!.inputCost).toBe(0.002)
    expect(est!.outputCost).toBe(0.004)
    expect(est!.cachedCost).toBe(0)
    expect(est!.totalCost).toBe(0.006)
  })

  it('represents cached input pricing separately when provided', () => {
    const est = estimateCost(
      { inputPricePerMillion: 2, outputPricePerMillion: 8, cachedInputPricePerMillion: 0.5 },
      { inputTokens: 1000, outputTokens: 0, cachedTokens: 600 }
    )
    // uncached input = 400 tokens, cached = 600 tokens @ $0.5/1M
    expect(est!.inputCost).toBe(0.0008)
    expect(est!.cachedCost).toBe(0.0003)
    expect(est!.totalCost).toBe(0.0011)
  })

  it('returns null when input price is unknown', () => {
    expect(
      estimateCost({ inputPricePerMillion: null, outputPricePerMillion: 8 }, { inputTokens: 1, outputTokens: 1, cachedTokens: 0 })
    ).toBeNull()
  })

  it('returns null when output price is unknown', () => {
    expect(
      estimateCost({ inputPricePerMillion: 2, outputPricePerMillion: null }, { inputTokens: 1, outputTokens: 1, cachedTokens: 0 })
    ).toBeNull()
  })

  it('clamps negative token deltas to zero', () => {
    const est = estimateCost(
      { inputPricePerMillion: 2, outputPricePerMillion: 8 },
      { inputTokens: 100, outputTokens: 50, cachedTokens: 200 }
    )
    // effective input = max(0, 100-200)=0
    expect(est!.inputCost).toBe(0)
    expect(est!.cachedCost).toBe(0.0004) // 200 * $2/1M
  })
})
