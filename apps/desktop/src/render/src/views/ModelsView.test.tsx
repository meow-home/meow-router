import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelsView } from './ModelsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('ModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
    gw.listModelsByProvider.mockResolvedValue([{ id: 'm1', provider_id: 'p1', provider_model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: 64000, input_price: 0.1, output_price: 0.3, capabilities_json: '{}', enabled: true, discovered_at: '' }])
  })

  it('renders models for selected provider', async () => {
    render(<ModelsView />)
    expect(await screen.findByText('DeepSeek Chat')).toBeTruthy()
  })

  it('refreshes models', async () => {
    gw.discoverModels.mockResolvedValue([{ id: 'm1', providerModelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: {} }])
    render(<ModelsView />)
    fireEvent.click(await screen.findByText(/Refresh models/i))
    await waitFor(() => expect(gw.discoverModels).toHaveBeenCalledWith('p1'))
  })
})
