import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AddProviderModal } from './AddProviderModal'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>
const types = [{ id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }]

describe('AddProviderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.createProvider.mockResolvedValue({ id: 'p2', type: 'deepseek', display_name: '', enabled: true, base_url: '', hasCredential: false, created_at: '', updated_at: '' })
    gw.setProviderCredential.mockResolvedValue(undefined)
  })

  it('does not render when closed', () => {
    const { container } = render(<AddProviderModal open={false} types={types} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(container.querySelector('.dialog')).toBeNull()
  })

  it('submits and calls createProvider then onCreated', async () => {
    const onCreated = vi.fn()
    render(<AddProviderModal open types={types} onClose={vi.fn()} onCreated={onCreated} />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'DeepSeek 2' } })
    fireEvent.change(inputs[1], { target: { value: 'https://api.example.com/v1' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: 'https://api.example.com/v1' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' })))
  })

  it('stores credential when a key is provided', async () => {
    render(<AddProviderModal open types={types} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'DeepSeek 2' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p2', 'sk-secret'))
  })
})
