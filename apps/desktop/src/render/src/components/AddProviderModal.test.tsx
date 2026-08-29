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
    render(<AddProviderModal open={false} types={types} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(document.querySelector('.dialog')).toBeNull()
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

  it('does not store a credential when no key is provided', async () => {
    const onCreated = vi.fn()
    render(<AddProviderModal open types={types} onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'DeepSeek 2' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: undefined }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(gw.setProviderCredential).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the modal open when createProvider rejects', async () => {
    gw.createProvider.mockRejectedValue(new Error('boom'))
    const onClose = vi.fn()
    const onCreated = vi.fn()
    render(<AddProviderModal open types={types} onClose={onClose} onCreated={onCreated} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'DeepSeek 2' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/boom/i)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    const saveBtn = screen.getByText('Save Provider').closest('button')
    expect(saveBtn?.disabled).toBe(false)
  })
})
