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

  it('adds a provider and stores credential', async () => {
    gw.createProvider.mockResolvedValue({ id: 'p2', type: 'deepseek', display_name: 'DeepSeek 2', enabled: true, base_url: '', hasCredential: false, created_at: '', updated_at: '' })
    gw.listProviders.mockResolvedValue([])
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Add Provider'))
    fireEvent.change(await screen.findByLabelText(/display name/i), { target: { value: 'DeepSeek 2' } })
    fireEvent.change(await screen.findByLabelText(/api key/i), { target: { value: 'sk-secret' } })
    fireEvent.click(await screen.findByText(/Save Provider/i))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: undefined }))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p2', 'sk-secret'))
  })
})
