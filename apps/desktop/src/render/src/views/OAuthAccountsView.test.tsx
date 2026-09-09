import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OAuthAccountsView } from './OAuthAccountsView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

const validAccount = {
  providerId: 'ag1',
  email: 'alice@gmail.com',
  displayName: 'Alice Smith',
  expiresAt: Date.now() + 3600000,
  valid: true,
}

const staleAccount = {
  providerId: 'ag2',
  email: 'bob@gmail.com',
  displayName: 'Bob Jones',
  expiresAt: Date.now() - 1000,
  valid: false,
}

describe('OAuthAccountsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.oauthListAccounts.mockResolvedValue([])
  })

  it('renders empty state when no accounts', async () => {
    render(<OAuthAccountsView />)
    expect(await screen.findByText('No connected accounts')).toBeTruthy()
  })

  it('renders the Google branded sign-in button', async () => {
    render(<OAuthAccountsView />)
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeTruthy()
  })

  it('renders account cards with avatars', async () => {
    gw.oauthListAccounts.mockResolvedValue([validAccount])
    render(<OAuthAccountsView />)
    // Avatar shows first letter of displayName
    expect(await screen.findByText('A')).toBeTruthy()
    expect(screen.getByText('Alice Smith')).toBeTruthy()
    expect(screen.getByText('alice@gmail.com')).toBeTruthy()
  })

  it('shows Connected pill for valid accounts', async () => {
    gw.oauthListAccounts.mockResolvedValue([validAccount])
    render(<OAuthAccountsView />)
    expect(await screen.findByText('Connected')).toBeTruthy()
  })

  it('shows Needs re-auth pill and Reconnect button for invalid accounts', async () => {
    gw.oauthListAccounts.mockResolvedValue([staleAccount])
    render(<OAuthAccountsView />)
    expect(await screen.findByText('Needs re-auth')).toBeTruthy()
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeTruthy()
  })

  it('shows Sign out button for valid accounts', async () => {
    gw.oauthListAccounts.mockResolvedValue([validAccount])
    render(<OAuthAccountsView />)
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeTruthy()
  })

  it('shows both Sign out and Reconnect for invalid accounts', async () => {
    gw.oauthListAccounts.mockResolvedValue([staleAccount])
    render(<OAuthAccountsView />)
    await screen.findByText('Bob Jones')
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy()
  })

  it('calls oauthLogout on Sign out click', async () => {
    gw.oauthListAccounts.mockResolvedValue([validAccount])
    render(<OAuthAccountsView />)
    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(gw.oauthLogout).toHaveBeenCalledWith('ag1'))
  })

  it('calls oauthStartLogin and oauthCompleteLogin on Sign in', async () => {
    render(<OAuthAccountsView />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in with google/i }))
    await waitFor(() => expect(gw.oauthStartLogin).toHaveBeenCalledWith('antigravity'))
    await waitFor(() => expect(gw.oauthCompleteLogin).toHaveBeenCalledWith('antigravity'))
  })

  it('disables sign-in button while logging in', async () => {
    // Make oauthStartLogin hang to test loading state
    gw.oauthStartLogin.mockReturnValue(new Promise(() => {}))
    render(<OAuthAccountsView />)
    const btn = await screen.findByRole('button', { name: /sign in with google/i })
    fireEvent.click(btn)
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true))
  })

  it('shows error banner on login failure', async () => {
    gw.oauthStartLogin.mockRejectedValue(new Error('auth failed'))
    render(<OAuthAccountsView />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in with google/i }))
    expect(await screen.findByText('auth failed')).toBeTruthy()
  })
})

const mockQuotaData = [{
  providerId: 'ag1',
  items: [
    { key: 'claude:5h', label: 'Claude (5h)', percentage: 65, resetTime: '2099-01-01T00:00:00Z' },
    { key: 'claude:weekly', label: 'Claude (Weekly)', percentage: 40, resetTime: '2099-01-07T00:00:00Z' }
  ],
  tier: 'individual',
  lastUpdatedAt: Date.now()
}]

describe('OAuthAccountsView quota display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.oauthListAccounts.mockResolvedValue([validAccount])
    gw.quotaList.mockResolvedValue([])
    gw.quotaRefresh.mockResolvedValue([])
  })

  it('renders quota bars when quotaList returns data for an account', async () => {
    gw.quotaList.mockResolvedValue(mockQuotaData)
    render(<OAuthAccountsView />)
    expect(await screen.findByText('Claude (5h)')).toBeTruthy()
    expect(screen.getByText('Claude (Weekly)')).toBeTruthy()
    expect(screen.getByText('65%')).toBeTruthy()
  })

  it('renders no quota section when quotaList returns empty array', async () => {
    render(<OAuthAccountsView />)
    await screen.findByText('Alice Smith')
    expect(screen.queryByText('Claude (5h)')).toBeNull()
    expect(screen.queryByText('No quota data')).toBeNull()
  })

  it('renders error text when quota data has error field', async () => {
    gw.quotaList.mockResolvedValue([{ providerId: 'ag1', items: [], tier: '', lastUpdatedAt: Date.now(), error: 'quota fetch failed' }])
    render(<OAuthAccountsView />)
    expect(await screen.findByText('quota fetch failed')).toBeTruthy()
  })

  it('renders No quota data when items empty and no error', async () => {
    gw.quotaList.mockResolvedValue([{ providerId: 'ag1', items: [], tier: '', lastUpdatedAt: Date.now() }])
    render(<OAuthAccountsView />)
    expect(await screen.findByText('No quota data')).toBeTruthy()
  })

  it('Refresh quota button calls quotaRefresh', async () => {
    render(<OAuthAccountsView />)
    fireEvent.click(await screen.findByRole('button', { name: /refresh quota/i }))
    await waitFor(() => expect(gw.quotaRefresh).toHaveBeenCalled())
  })

  it('Refresh quota button shows Refreshing quota… while loading', async () => {
    gw.quotaRefresh.mockReturnValue(new Promise(() => {}))
    render(<OAuthAccountsView />)
    fireEvent.click(await screen.findByRole('button', { name: /refresh quota/i }))
    expect(await screen.findByText('Refreshing quota…')).toBeTruthy()
  })
})

describe('OAuthAccountsView quota grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.oauthListAccounts.mockResolvedValue([validAccount])
    gw.quotaList.mockResolvedValue([])
    gw.quotaRefresh.mockResolvedValue([])
  })

  it('renders Claude and Gemini column titles from quota data', async () => {
    gw.quotaList.mockResolvedValue(mockQuotaData)
    render(<OAuthAccountsView />)
    expect(await screen.findByText('Claude')).toBeTruthy()
    expect(screen.getByText('Gemini')).toBeTruthy()
  })

  it('Refresh quota button sits in the quota-refresh row below the header', async () => {
    render(<OAuthAccountsView />)
    const btn = await screen.findByRole('button', { name: /refresh quota/i })
    const row = document.querySelector('.quota-refresh-row')
    expect(row).toBeTruthy()
    expect(row?.contains(btn)).toBe(true)
    // Refresh row is inside the scroll container, above the grid
    const mt = document.querySelector('.mt-4')
    expect(mt?.contains(row)).toBe(true)
  })
})
