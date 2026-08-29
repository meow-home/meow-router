import { vi } from 'vitest'

Object.defineProperty(window, 'meowGateway', {
  value: {
    ping: vi.fn().mockResolvedValue({ pong: 'pong', echo: '' }),
    listProviders: vi.fn().mockResolvedValue([]),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setProviderCredential: vi.fn(),
    testProviderConnection: vi.fn(),
    discoverModels: vi.fn().mockResolvedValue([]),
    listProviderTypes: vi.fn().mockResolvedValue([]),
    listModelsByProvider: vi.fn().mockResolvedValue([]),
    createModel: vi.fn().mockResolvedValue({ id: 'm', provider_id: '', provider_model_id: '', display_name: '', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false }),
    updateModel: vi.fn().mockResolvedValue({ id: 'm', provider_id: '', provider_model_id: '', display_name: '', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false }),
    deleteModel: vi.fn(),
    setModelEnabled: vi.fn(),
    gatewayGetStatus: vi.fn().mockResolvedValue({ running: true, host: '127.0.0.1', port: 8317 }),
    gatewayStart: vi.fn(),
    gatewayStop: vi.fn(),
    gatewayGetConfig: vi.fn().mockResolvedValue({ id: 1, host: '127.0.0.1', port: 8317, auth_enabled: false, startup_enabled: false }),
    gatewaySaveConfig: vi.fn(),
    usageDashboardTotals: vi.fn().mockResolvedValue({ totalRequests: 0, totalTokens: 0, totalCost: null, successRequests: 0, errorRequests: 0, abortedRequests: 0, byProvider: [] }),
    usageListRecent: vi.fn().mockResolvedValue([]),
    listVirtualModels: vi.fn().mockResolvedValue([]),
    getVirtualModel: vi.fn(),
    createVirtualModel: vi.fn(),
    updateVirtualModel: vi.fn(),
    deleteVirtualModel: vi.fn()
  },
  configurable: true
})
