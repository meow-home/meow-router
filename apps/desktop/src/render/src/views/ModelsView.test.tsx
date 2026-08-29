import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelsView } from './ModelsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('ModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
    gw.listModelsByProvider.mockResolvedValue([{ id: 'm1', provider_id: 'p1', provider_model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: 64000, input_price: 0.1, output_price: 0.3, capabilities_json: '{}', enabled: true, discovered_at: '', stale: false }])
  })

  it('renders models for selected provider', async () => {
    render(<ModelsView />)
    expect(await screen.findByText('DeepSeek Chat')).toBeTruthy()
  })

  it('syncs models', async () => {
    gw.discoverModels.mockResolvedValue([{ id: 'm1', providerModelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: {} }])
    render(<ModelsView />)
    fireEvent.click(await screen.findByText(/Sync Models/i))
    await waitFor(() => expect(gw.discoverModels).toHaveBeenCalledWith('p1'))
  })

  it('adds a model with the full schema', async () => {
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true, base_url: 'https://api.openai.com/v1', hasCredential: true, created_at: '', updated_at: '' }])
    gw.listModelsByProvider.mockResolvedValue([])
    gw.createModel.mockResolvedValue({ id: 'm', provider_id: 'p1', provider_model_id: 'gpt-4o', display_name: 'GPT-4o', context_window: 128000, input_price: 2.5, output_price: 10, capabilities_json: '{"streaming":true,"tools":true,"vision":true,"reasoning":false,"structuredOutput":false}', enabled: true, discovered_at: '', stale: false })
    render(<ModelsView />)
    fireEvent.click(await screen.findByText('Add Model'))
    fireEvent.change(await screen.findByLabelText(/provider model id/i), { target: { value: 'gpt-4o' } })
    fireEvent.change(await screen.findByLabelText(/display name/i), { target: { value: 'GPT-4o' } })
    fireEvent.click(await screen.findByLabelText(/vision/i))
    fireEvent.click(await screen.findByText(/Save Model/i))
    await waitFor(() => expect(gw.createModel).toHaveBeenCalledWith(expect.objectContaining({ provider_model_id: 'gpt-4o', provider_id: 'p1', display_name: 'GPT-4o', capabilities_json: expect.stringContaining('"vision":true') })))
  })

  it('syncs models and renders a stale badge', async () => {
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
    gw.listModelsByProvider.mockResolvedValue([{ id: 'm1', provider_id: 'p1', provider_model_id: 'old', display_name: 'Old', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: true }])
    gw.discoverModels.mockResolvedValue([])
    render(<ModelsView />)
    fireEvent.click(await screen.findByText('Sync Models'))
    await waitFor(() => expect(gw.discoverModels).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('stale')).toBeTruthy()
  })
})
