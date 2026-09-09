import { useCallback, useEffect, useState } from 'react'
import type { OAuthAccountMeta, AntigravityQuotaData } from '@shared/ipc'
import { ViewHeader, Button, Pill, ErrorBanner, EmptyState } from '../components/ui'
import { QuotaGroup } from '../components/QuotaGroup'

const OAUTH_TYPE = 'antigravity'

/** Inline 18×18 Google "G" logo SVG (4-colour). */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.08 24.08 0 0 0 0 21.56l7.98-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** First character of displayName, uppercase, for the avatar circle. */
function avatarInitial(name: string): string {
  return (name.charAt(0) || '?').toUpperCase()
}

export function OAuthAccountsView() {
  const [accounts, setAccounts] = useState<OAuthAccountMeta[]>([])
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quotaData, setQuotaData] = useState<Record<string, AntigravityQuotaData>>({})
  const [quotaRefreshing, setQuotaRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setAccounts(await window.meowGateway.oauthListAccounts(OAUTH_TYPE))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const loadQuota = useCallback(async () => {
    try {
      const items = await window.meowGateway.quotaList()
      const map: Record<string, AntigravityQuotaData> = {}
      for (const item of items) map[item.providerId] = item
      setQuotaData(map)
    } catch {
      // silent — quota is non-critical
    }
  }, [])

  const refreshQuota = useCallback(async () => {
    setQuotaRefreshing(true)
    try {
      const items = await window.meowGateway.quotaRefresh()
      const map: Record<string, AntigravityQuotaData> = {}
      for (const item of items) map[item.providerId] = item
      setQuotaData(map)
    } catch {
      // silent
    } finally {
      setQuotaRefreshing(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    loadQuota()
    const interval = setInterval(loadQuota, 60_000)
    return () => clearInterval(interval)
  }, [loadQuota])

  async function handleSignIn() {
    setLoggingIn(true)
    setError(null)
    try {
      await window.meowGateway.oauthStartLogin(OAUTH_TYPE)
      await window.meowGateway.oauthCompleteLogin(OAUTH_TYPE)
      await refresh()
      await loadQuota()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleReconnect() {
    setLoggingIn(true)
    setError(null)
    try {
      await window.meowGateway.oauthStartLogin(OAUTH_TYPE)
      await window.meowGateway.oauthCompleteLogin(OAUTH_TYPE)
      await refresh()
      await loadQuota()
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
        title="OAuth Connections"
        subtitle="Providers that authenticate with a Google account instead of an API key."
      >
        <button
          className="google-signin-btn"
          onClick={handleSignIn}
          disabled={loggingIn}
        >
          <GoogleLogo />
          {loggingIn ? 'Waiting for authorisation…' : 'Sign in with Google'}
        </button>
      </ViewHeader>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="mt-4">
        {accounts.length === 0 && (
          <EmptyState
            title="No connected accounts"
            hint="Sign in with Google to use Antigravity as a provider."
          />
        )}
        <div className="oauth-grid">
          {accounts.map((a) => (
            <div
              key={a.providerId}
              className={`oauth-card${a.valid ? '' : ' oauth-card--stale'}`}
            >
              <div className="oauth-card-top">
                <div className="oauth-avatar">{avatarInitial(a.displayName)}</div>
                <div className="oauth-card-info">
                  <div className="oauth-name">{a.displayName}</div>
                  <div className="oauth-email">{a.email}</div>
                </div>
                <Pill tone={a.valid ? 'ok' : 'warn'}>
                  {a.valid ? 'Connected' : 'Needs re-auth'}
                </Pill>
              </div>
              {quotaData[a.providerId] && (
                <div className="oauth-quota-section">
                  {quotaData[a.providerId].error ? (
                    <div className="oauth-quota-error">{quotaData[a.providerId].error}</div>
                  ) : quotaData[a.providerId].items.length === 0 ? (
                    <div className="oauth-quota-empty">No quota data</div>
                  ) : (
                    <QuotaGroup items={quotaData[a.providerId].items} />
                  )}
                </div>
              )}
              <div className="oauth-card-actions">
                {!a.valid && (
                  <Button variant="primary" onClick={handleReconnect} disabled={loggingIn}>
                    Reconnect
                  </Button>
                )}
                <Button variant="danger" onClick={() => handleSignOut(a.providerId)}>
                  Sign out
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="quota-refresh-row">
          <Button variant="ghost" onClick={refreshQuota} disabled={quotaRefreshing}>
            {quotaRefreshing ? 'Refreshing quota…' : 'Refresh quota'}
          </Button>
        </div>
      </div>
    </div>
  )
}
