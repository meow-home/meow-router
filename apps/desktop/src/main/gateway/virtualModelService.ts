// Binds the virtual-model repository to the gateway's model-resolution contract.
//
// The gateway server only knows about resolveModel(id) -> ResolvedModel and
// listModels() -> OpenAI model descriptors. This adapter reads the DB repository
// to answer both, keeping the gateway provider-neutral and the renderer unaware
// of how models map to providers.

import type { VirtualModelRepository } from '../database/repositories/virtualModelRepository'
import type { ResolvedModel } from './types'
import type { ModelInfo } from '@meow-gateway/provider-core'

function toModelInfo(vm: { provider_model_id: string }): ModelInfo {
  return {
    id: vm.provider_model_id,
    providerModelId: vm.provider_model_id,
    displayName: vm.provider_model_id,
    capabilities: { streaming: true, tools: true, vision: false, reasoning: false, structuredOutput: true }
  }
}

export class VirtualModelService {
  constructor(private readonly repo: VirtualModelRepository) {}

  async resolveModel(id: string): Promise<ResolvedModel | null> {
    // Accept either the virtual model display name or its internal id.
    const vm = this.repo.findByDisplayName(id) ?? this.repo.findById(id)
    if (!vm || !vm.enabled) return null
    return {
      providerId: vm.provider_id,
      providerModelId: vm.provider_model_id,
      model: toModelInfo(vm)
    }
  }

  async listModels(): Promise<Array<{ id: string; object: string; owned_by: string }>> {
    return this.repo.listEnabled().map((vm) => ({
      id: vm.display_name,
      object: 'model',
      owned_by: 'meow-gateway'
    }))
  }
}
