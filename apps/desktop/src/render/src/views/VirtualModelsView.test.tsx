import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VirtualModelsView } from './VirtualModelsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('VirtualModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listVirtualModels.mockResolvedValue([{ id: 'vm1', display_name: 'meow-coding', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' }])
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
    gw.listModelsByProvider.mockResolvedValue([{ id: 'm1', provider_id: 'p1', provider_model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false }])
    gw.createVirtualModel.mockResolvedValue({ id: 'vm2', display_name: 'my-model', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' })
    gw.deleteVirtualModel.mockResolvedValue(true)
  })

  it('renders virtual models', async () => {
    render(<VirtualModelsView />)
    expect(await screen.findByText('meow-coding')).toBeTruthy()
  })

  it('creates a virtual model by picking a provider model from the list', async () => {
    render(<VirtualModelsView />)
    fireEvent.click(await screen.findByText(/New Virtual Model/i))
    // The modal loads models for the default provider and auto-selects the first.
    await screen.findByText('deepseek-chat')
    fireEvent.change(await screen.findByLabelText(/public model name/i), { target: { value: 'my-model' } })
    fireEvent.click(await screen.findByText(/Save Virtual Model/i))
    await waitFor(() => expect(gw.createVirtualModel).toHaveBeenCalledWith({
      display_name: 'my-model',
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      routing_policy_id: null,
    }))
  })

  it('edits an existing virtual model', async () => {
    gw.updateVirtualModel.mockResolvedValue({ id: 'vm1', display_name: 'renamed', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' })
    render(<VirtualModelsView />)
    fireEvent.click(await screen.findByText('Edit'))
    // Editing seeds the existing model id even before the (async) list loads.
    await screen.findByLabelText(/public model name/i)
    fireEvent.change(screen.getByLabelText(/public model name/i), { target: { value: 'renamed' } })
    fireEvent.click(await screen.findByText(/Save Changes/i))
    await waitFor(() => expect(gw.updateVirtualModel).toHaveBeenCalledWith('vm1', expect.objectContaining({ display_name: 'renamed' })))
  })

  it('requires confirmation before deleting a virtual model', async () => {
    render(<VirtualModelsView />)
    fireEvent.click(await screen.findByText('Delete'))
    // Confirm dialog is shown; deletion is not yet called.
    expect(gw.deleteVirtualModel).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: /Delete virtual model/i })
    expect(dialog.textContent).toContain('Delete "meow-coding"')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(gw.deleteVirtualModel).toHaveBeenCalledWith('vm1'))
  })
})
