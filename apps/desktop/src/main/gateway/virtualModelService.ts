// Binds the virtual-model repository to the gateway's model-resolution contract.
//
// The gateway server only knows about resolveModel(id) -> ResolvedModel,
// resolveRoutes(id) -> ordered routes, and listModels() -> OpenAI descriptors.
// This adapter reads the DB repository to answer all three, keeping the gateway
// provider-neutral and the renderer unaware of how models map to providers.

import type { VirtualModelRepository } from '../database/repositories/virtualModelRepository'
import type { RoutingPolicyRepository } from '../database/repositories/routingPolicyRepository'
import type { ProviderRepository } from '../database/repositories/providerRepository'
import type { ResolvedModel, RouteCandidate, RouteList } from './types'
import type { ModelInfo } from '@meow-gateway/provider-core'

// Hard cap on fallback attempts to guarantee termination (loop prevention).
export const MAX_ROUTES = 8

function toModelInfo(vm: { provider_model_id: string; provider_id: string }): ModelInfo {
  return {
    id: vm.provider_model_id,
    providerModelId: vm.provider_model_id,
    displayName: vm.provider_model_id,
    capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true }
  }
}

export class VirtualModelService {
  constructor(
    private readonly repo: VirtualModelRepository,
    private readonly routingPolicies: RoutingPolicyRepository | null = null,
    // Supplies each route's endpoint. Optional so existing callers keep working,
    // but the gateway must pass it or adapters fall back to their own default.
    private readonly providers: ProviderRepository | null = null
  ) {}

  private baseUrlFor(providerId: string): string | undefined {
    return this.providers?.findById(providerId)?.base_url ?? undefined
  }

  async resolveModel(id: string): Promise<ResolvedModel | null> {
    // Accept either the virtual model display name or its internal id.
    const vm = this.repo.findByDisplayName(id) ?? this.repo.findById(id)
    if (!vm || !vm.enabled) return null
    const baseUrl = this.baseUrlFor(vm.provider_id)
    return {
      providerId: vm.provider_id,
      providerModelId: vm.provider_model_id,
      ...(baseUrl ? { baseUrl } : {}),
      model: toModelInfo(vm)
    }
  }

  // Resolve an ordered list of candidate routes for a virtual model.
  // Primary route is the virtual model's own mapping; fallback candidates come
  // from the attached routing policy (if any). Loop prevention: dedupe by
  // provider and cap the number of routes.
  async resolveRoutes(id: string): Promise<RouteList> {
    const vm = this.repo.findByDisplayName(id) ?? this.repo.findById(id)
    if (!vm || !vm.enabled) return { routes: [], usedFallback: false }

    const routes: RouteCandidate[] = [{ providerId: vm.provider_id, providerModelId: vm.provider_model_id }]
    const seen = new Set<string>([vm.provider_id])

    if (vm.routing_policy_id && this.routingPolicies) {
      const candidates = this.routingPolicies.candidates(vm.routing_policy_id)
      for (const c of candidates) {
        if (seen.has(c.providerId)) continue // loop prevention
        if (routes.length >= MAX_ROUTES) break
        seen.add(c.providerId)
        routes.push({ providerId: c.providerId, providerModelId: c.providerModelId })
      }
    }

    return { routes, usedFallback: routes.length > 1 }
  }

  async listModels(): Promise<Array<{ id: string; object: string; owned_by: string }>> {
    return this.repo.listEnabled().map((vm) => ({
      id: vm.display_name,
      object: 'model',
      owned_by: 'meow-gateway'
    }))
  }
}
