// Runtime registry mapping providerId -> ProviderAdapter.
//
// This is the only place provider packages are imported/aggregated. The gateway
// worker and main process depend on the registry, never on a specific provider
// package directly — resolution happens here.

import type { ProviderAdapter } from './types'

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Provider adapter already registered: ${adapter.id}`)
    }
    this.adapters.set(adapter.id, adapter)
  }

  unregister(providerId: string): boolean {
    return this.adapters.delete(providerId)
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId)
  }

  require(providerId: string): ProviderAdapter {
    const adapter = this.get(providerId)
    if (!adapter) {
      throw new Error(`No provider adapter registered for: ${providerId}`)
    }
    return adapter
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()]
  }

  ids(): string[] {
    return [...this.adapters.keys()]
  }
}
