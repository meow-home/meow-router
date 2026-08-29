import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditProviderModal } from './EditProviderModal'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>
const types = [{ id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }]
const provider = { id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', hasCredential: true, created_at: '', updated_at: '' }

describe('EditProviderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.updateProvider.mockResolvedValue(provider)
    gw.setProviderCredential.mockResolvedValue(undefined)
  })

  it('does not render when closed', () => {
    render(<EditProviderModal open={false} provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    expect(document.querySelector('.dialog')).toBeNull()
  })

  it('prefills and disables the type select, calls updateProvider with enabled', async () => {
    render(<EditProviderModal open provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    const select = document.querySelector('select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Enabled' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLInputElement)
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalledWith('p1', { display_name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', enabled: false }))
  })

  it('normalizes an empty base_url to null on submit', async () => {
    const noBaseProvider = { ...provider, base_url: null }
    render(<EditProviderModal open provider={noBaseProvider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalledWith('p1', { display_name: 'DeepSeek', base_url: null, enabled: true }))
  })

  it('calls setProviderCredential when a new key is entered', async () => {
    render(<EditProviderModal open provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p1', 'sk-new'))
  })

  it('does NOT call setProviderCredential when key is blank', async () => {
    render(<EditProviderModal open provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.setProviderCredential).not.toHaveBeenCalled())
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalled())
  })
})
