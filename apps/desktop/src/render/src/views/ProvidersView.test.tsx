import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProvidersView } from './ProvidersView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('ProvidersView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.listProviders.mockResolvedValue([
      { id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', hasCredential: true, created_at: '', updated_at: '' }
    ])
    gw.listProviderTypes.mockResolvedValue([{ id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }])
  })

  it('renders providers with hasCredential badge', async () => {
    render(<ProvidersView />)
    expect(await screen.findByText('DeepSeek')).toBeTruthy()
    expect(screen.getByText(/key set/i)).toBeTruthy()
  })

  it('does not leak the secret into the DOM', async () => {
    render(<ProvidersView />)
    await screen.findByText('DeepSeek')
    expect(document.body.textContent).not.toContain('sk-secret')
  })

  it('opens the add modal and stores credential', async () => {
    gw.createProvider.mockResolvedValue({ id: 'p2', type: 'deepseek', display_name: 'DeepSeek 2', enabled: true, base_url: '', hasCredential: false, created_at: '', updated_at: '' })
    gw.listProviders.mockResolvedValue([])
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Add Provider'))
    // the add modal opens
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const displayName = screen.getByLabelText('Display name')
    const apiKey = screen.getByLabelText('API key')
    fireEvent.change(displayName, { target: { value: 'DeepSeek 2' } })
    fireEvent.change(apiKey, { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: undefined }))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p2', 'sk-secret'))
  })

  it('opens the edit modal when Edit is clicked and updates the provider', async () => {
    gw.updateProvider.mockResolvedValue({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', hasCredential: true, created_at: '', updated_at: '' })
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Edit'))
    // the edit modal opens
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // type select is disabled in edit mode
    const select = document.querySelector('.dialog select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    // pre-fills the provider's display name
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('DeepSeek')
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalledWith('p1', { display_name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', enabled: true }))
  })

  it('sends base_url null when editing a provider without a base URL', async () => {
    gw.listProviders.mockResolvedValue([{ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: null, hasCredential: true, created_at: '', updated_at: '' }])
    gw.updateProvider.mockResolvedValue({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: null, hasCredential: true, created_at: '', updated_at: '' })
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Edit'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalledWith('p1', { display_name: 'DeepSeek', base_url: null, enabled: true }))
  })
})
