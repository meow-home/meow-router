// Records request usage with cost estimation.
//
// Binds the UsageRepository, ModelRepository (pricing source) and CostCalculator
// so the gateway's recordUsage callback can compute + persist a real row.

import type { UsageRepository, DashboardTotals } from '../database/repositories/usageRepository'
import type { ModelRepository } from '../database/repositories/modelRepository'
import type { GatewayUsage } from './types'
import { estimateCost, type CostEstimate } from './costCalculator'

export class UsageService {
  constructor(
    private readonly usageRepo: UsageRepository,
    private readonly modelRepo: ModelRepository
  ) {}

  async recordUsage(usage: GatewayUsage): Promise<void> {
    const cost = this.estimate(usage)
    this.usageRepo.record({
      request_id: usage.requestId,
      virtual_model_id: usage.virtualModelId,
      provider_id: usage.providerId,
      provider_model_id: usage.providerModelId,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_tokens: usage.cachedTokens,
      estimated_cost: cost?.totalCost ?? null,
      latency_ms: usage.latencyMs,
      status: usage.status,
      error_code: usage.errorCode ?? null,
      error_message: usage.errorMessage ?? null
    })
  }

  // Resolve per-model pricing (per-1M tokens) and estimate cost.
  estimate(usage: GatewayUsage): CostEstimate | null {
    const model = this.modelRepo.findByProviderModel(usage.providerId, usage.providerModelId)
    if (!model) return null
    return estimateCost(
      {
        inputPricePerMillion: model.input_price,
        outputPricePerMillion: model.output_price
      },
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens
      }
    )
  }

  totals(): DashboardTotals {
    return this.usageRepo.dashboardTotals()
  }
}
