import { useCallback, useEffect, useState } from 'react'
import type { OAuthAccountMeta } from '@shared/ipc'
import { ViewHeader, Button, ErrorBanner, EmptyState } from '../components/ui'

const OAUTH_TYPES = ['antigravity']

export function OAuthAccountsView() {
  const [type] = useState<string>(OAUTH_TYPES[0])
  const [accounts, setAccounts] = useState<OAuthAccountMeta[]>([])
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setAccounts(await window.meowGateway.oauthListAccounts(type))
    } catch (e) {
      setError(String(e))
    }
  }, [type])

  useEffect(() => { refresh() }, [refresh])

  async function handleSignIn() {
    setLoggingIn(true)
    setError(null)
    try {
      await window.meowGateway.oauthStartLogin(type)
      // The system browser opens for consent and redirects to the local callback
      // server; completeLogin waits for that callback and exchanges the code.
      await window.meowGateway.oauthCompleteLogin(type)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleSignOut(providerId: string) {
    try {
      await window.meowGateway.oauthLogout(providerId)
      setError(null)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="view">
      <ViewHeader
        title="OAuth Accounts"
        subtitle="Providers that authenticate with a Google account instead of an API key."
      >
        <Button variant="primary" onClick={handleSignIn} disabled={loggingIn}>
          {loggingIn ? 'Waiting for authorisation…' : '+ Sign in with Google'}
        </Button>
      </ViewHeader>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="mt-4">
        {accounts.length === 0 && (
          <EmptyState title="No connected accounts" hint="Sign in with Google to use Antigravity as a provider." />
        )}
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.providerId} className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="font-medium">{a.displayName}</div>
                <div className="text-sm text-dim">{a.email}</div>
                <div className="text-xs text-dim">{a.valid ? 'Connected' : 'Needs re-auth'}</div>
              </div>
              {a.valid && (
                <Button variant="danger" onClick={() => handleSignOut(a.providerId)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
