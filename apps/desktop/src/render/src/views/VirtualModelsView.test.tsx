import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VirtualModelsView } from './VirtualModelsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('VirtualModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listVirtualModels.mockResolvedValue([{ id: 'vm1', display_name: 'meow-coding', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' }])
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: '', hasCredential: true, created_at: '', updated_at: '' }])
  })

  it('renders virtual models', async () => {
    render(<VirtualModelsView />)
    expect(await screen.findByText('meow-coding')).toBeTruthy()
  })

  it('creates a virtual model', async () => {
    gw.createVirtualModel.mockResolvedValue({ id: 'vm2', display_name: 'my-model', provider_id: 'p1', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' })
    render(<VirtualModelsView />)
    fireEvent.click(await screen.findByText(/New Virtual Model/i))
    fireEvent.change(await screen.findByLabelText(/display name/i), { target: { value: 'my-model' } })
    fireEvent.change(await screen.findByLabelText(/provider model id/i), { target: { value: 'deepseek-chat' } })
    fireEvent.click(await screen.findByText(/Save/i))
    await waitFor(() => expect(gw.createVirtualModel).toHaveBeenCalled())
  })
})
