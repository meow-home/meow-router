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

  describe('display name defaults to the selected type', () => {
    const many = [
      types[0],
      { id: 'groq', displayName: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', authType: 'bearer' as const },
      { id: 'opencode', displayName: 'opencode Zen', defaultBaseUrl: 'https://opencode.ai/zen/v1', authType: 'bearer' as const },
    ]

    function open() {
      render(<AddProviderModal open types={many} onClose={vi.fn()} onCreated={vi.fn()} />)
      return {
        name: screen.getByLabelText('Display name') as HTMLInputElement,
        type: screen.getByRole('combobox') as HTMLSelectElement,
      }
    }

    it('prefills with the default type name on open', () => {
      const { name } = open()
      expect(name.value).toBe('DeepSeek')
    })

    it('follows the type while the name is untouched', () => {
      const { name, type } = open()
      fireEvent.change(type, { target: { value: 'groq' } })
      expect(name.value).toBe('Groq')
      fireEvent.change(type, { target: { value: 'opencode' } })
      expect(name.value).toBe('opencode Zen')
    })

    it('keeps a hand-typed name when the type changes', () => {
      const { name, type } = open()
      fireEvent.change(name, { target: { value: 'Con meo' } })
      fireEvent.change(type, { target: { value: 'groq' } })
      expect(name.value).toBe('Con meo')
    })

    it('resumes prefilling after the name is cleared', () => {
      const { name, type } = open()
      fireEvent.change(name, { target: { value: 'Con meo' } })
      fireEvent.change(name, { target: { value: '' } })
      fireEvent.change(type, { target: { value: 'groq' } })
      expect(name.value).toBe('Groq')
    })
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
