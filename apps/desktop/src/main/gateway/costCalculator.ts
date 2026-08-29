// Deterministic cost estimation from token usage and model pricing data.
//
// Pricing is data/configuration (per-1M-tokens input/output/cached), never
// hard-coded here. When pricing is unknown the calculator returns `null` —
// it never fabricates a number. Cached input pricing is represented separately
// when the pricing config provides it.

export interface PricingInput {
  inputPricePerMillion: number | null
  outputPricePerMillion: number | null
  cachedInputPricePerMillion?: number | null
}

export interface TokenUsageInput {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

export interface CostEstimate {
  inputCost: number
  outputCost: number
  cachedCost: number
  totalCost: number
}

// Returns null when any required price is unknown so callers surface
// 'unknown' rather than inventing a number.
export function estimateCost(pricing: PricingInput, usage: TokenUsageInput): CostEstimate | null {
  if (pricing.inputPricePerMillion == null || pricing.outputPricePerMillion == null) {
    return null
  }

  const perToken = (pricePerMillion: number) => pricePerMillion / 1_000_000

  const effectiveInput = Math.max(0, usage.inputTokens - usage.cachedTokens)
  const cached = usage.cachedTokens

  const cachedPrice =
    pricing.cachedInputPricePerMillion === undefined || pricing.cachedInputPricePerMillion === null
      ? pricing.inputPricePerMillion
      : pricing.cachedInputPricePerMillion

  const inputCost = effectiveInput * perToken(pricing.inputPricePerMillion)
  const outputCost = usage.outputTokens * perToken(pricing.outputPricePerMillion)
  const cachedCost = cached * perToken(cachedPrice)

  return {
    inputCost: round(inputCost),
    outputCost: round(outputCost),
    cachedCost: round(cachedCost),
    totalCost: round(inputCost + outputCost + cachedCost)
  }
}

function round(n: number): number {
  // Keep 8 decimal places to avoid floating-point noise in cost calc tests.
  return Math.round(n * 1e8) / 1e8
}
