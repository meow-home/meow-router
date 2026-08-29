import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VirtualModelModal } from './VirtualModelModal'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

const providers = [
  { id: 'deepseek', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: null, created_at: '', updated_at: '', hasCredential: true, credentialRef: 'provider:deepseek' },
  { id: 'openai', type: 'openai', display_name: 'OpenAI', enabled: true, base_url: null, created_at: '', updated_at: '', hasCredential: true, credentialRef: 'provider:openai' },
]

const deepseekModels = [
  { id: 'm1', provider_id: 'deepseek', provider_model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false },
  { id: 'm2', provider_id: 'deepseek', provider_model_id: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', context_window: null, input_price: null, output_price: null, capabilities_json: null, enabled: true, discovered_at: '', stale: false },
]

const existing = { id: 'vm1', display_name: 'meow-coding', provider_id: 'deepseek', provider_model_id: 'deepseek-chat', routing_policy_id: null, enabled: true, created_at: '', updated_at: '' }

describe('VirtualModelModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listModelsByProvider.mockResolvedValue(deepseekModels)
    gw.createVirtualModel.mockResolvedValue({ ...existing, id: 'vm-new' })
    gw.updateVirtualModel.mockResolvedValue(existing)
  })

  it('creates a new virtual model on submit', async () => {
    const onSaved = vi.fn()
    render(<VirtualModelModal open providers={providers} initial={null} onClose={vi.fn()} onSaved={onSaved} />)
    await screen.findByText('deepseek-chat')
    fireEvent.change(screen.getByRole('textbox', { name: 'Public model name' }), { target: { value: 'my-model' } })
    screen.getByRole('button', { name: /Save Virtual Model/i }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(gw.createVirtualModel).toHaveBeenCalledWith({
      display_name: 'my-model',
      provider_id: 'deepseek',
      provider_model_id: 'deepseek-chat',
      routing_policy_id: null,
    })
  })

  it('edits an existing virtual model on submit', async () => {
    const onSaved = vi.fn()
    render(<VirtualModelModal open providers={providers} initial={existing} onClose={vi.fn()} onSaved={onSaved} />)
    await screen.findByText('deepseek-chat')
    expect(screen.getByRole('heading', { name: /Edit Virtual Model/i })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Public model name' }), { target: { value: 'renamed-model' } })
    screen.getByRole('button', { name: /Save Changes/i }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(gw.updateVirtualModel).toHaveBeenCalledWith('vm1', {
      display_name: 'renamed-model',
      provider_id: 'deepseek',
      provider_model_id: 'deepseek-chat',
      routing_policy_id: null,
    })
  })

  it('keeps the existing model id even when absent from the fetched list', async () => {
    gw.listModelsByProvider.mockResolvedValue([])
    const onSaved = vi.fn()
    render(<VirtualModelModal open providers={providers} initial={existing} onClose={vi.fn()} onSaved={onSaved} />)
    await screen.findByText('deepseek-chat')
    const save = screen.getByRole('button', { name: /Save Changes/i }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })
})
