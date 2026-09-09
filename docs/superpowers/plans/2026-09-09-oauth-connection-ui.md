# OAuth Connection UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the OAuth Accounts view from a plain list into a card-based layout with avatars, Pill status badges, a Google-branded Sign-In button, and a Reconnect action for expired tokens.

**Architecture:** Pure frontend change. Rewrite `OAuthAccountsView.tsx` using existing UI primitives (`ViewHeader`, `Button`, `Pill`, `ErrorBanner`, `EmptyState`) plus new CSS classes in `meow.css`. No backend/IPC changes.

**Tech Stack:** React, TypeScript, Vitest, @testing-library/react, CSS (design tokens from meow.css)

## Global Constraints

- TypeScript strict mode
- No backend/IPC changes — `OAuthAccountMeta` interface unchanged
- Use existing design tokens from `meow.css` (`--bg-panel`, `--hairline`, `--radius`, `--space-*`, etc.)
- Use existing UI components: `ViewHeader`, `Button`, `Pill`, `ErrorBanner`, `EmptyState`
- Renderer must NOT receive raw API keys
- Follow existing test patterns (vitest + @testing-library/react, mock `window.meowGateway`)

---

### Task 1: Add OAuth mock methods to test setup & add CSS classes

**Files:**
- Modify: `apps/desktop/src/render/src/test/setup.ts` (add OAuth mock methods)
- Modify: `apps/desktop/src/render/src/styles/meow.css` (add `.oauth-*` classes at end)

**Interfaces:**
- Consumes: nothing
- Produces: OAuth mock methods on `window.meowGateway` (`oauthStartLogin`, `oauthCompleteLogin`, `oauthListAccounts`, `oauthLogout`); CSS classes `.oauth-grid`, `.oauth-card`, `.oauth-card--stale`, `.oauth-avatar`, `.oauth-card-info`, `.oauth-card-actions`, `.google-signin-btn`

- [ ] **Step 1: Add OAuth mocks to test setup**

In `apps/desktop/src/render/src/test/setup.ts`, add these four properties to the `meowGateway` mock object (inside the existing `value: { ... }` block, after `onUpdateReady`):

```ts
oauthStartLogin: vi.fn().mockResolvedValue({ pending: true, redirectUri: 'http://localhost:9999/callback' }),
oauthCompleteLogin: vi.fn().mockResolvedValue({ providerId: 'ag1', email: 'test@gmail.com', displayName: 'Test User', expiresAt: Date.now() + 3600000, valid: true }),
oauthListAccounts: vi.fn().mockResolvedValue([]),
oauthLogout: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: Add OAuth CSS classes to meow.css**

Append at the end of `apps/desktop/src/render/src/styles/meow.css` (before the closing comment or at very end):

```css
/* ---------- oauth cards ---------- */
.oauth-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--space-2);
}

.oauth-card {
  background: var(--bg-panel);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  padding: var(--space-3);
  display: flex; flex-direction: column; gap: var(--space-2);
  animation: meow-rise 260ms ease-out both;
}
.oauth-card--stale {
  border-color: rgba(255, 180, 84, 0.4);
}

.oauth-card-top {
  display: flex; align-items: center; gap: var(--space-2);
}

.oauth-avatar {
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: 2px solid rgba(255, 255, 255, 0.1);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display);
  font-size: 16px; font-weight: var(--fw-bold);
  color: #ffffff; text-transform: uppercase;
  line-height: 1; user-select: none;
}

.oauth-card-info {
  flex: 1; min-width: 0;
}
.oauth-card-info .oauth-name {
  font-family: var(--font-display); font-size: var(--fs-2);
  font-weight: var(--fw-semibold); color: var(--text-strong);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.oauth-card-info .oauth-email {
  font-family: var(--font-mono); font-size: var(--fs-1);
  color: var(--text-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.oauth-card-actions {
  display: flex; justify-content: flex-end; gap: var(--space-1);
}

/* Google-branded sign-in button */
.google-signin-btn {
  display: inline-flex; align-items: center; gap: 10px;
  background: #ffffff; color: #3c4043;
  border: 1px solid #dadce0; border-radius: var(--radius);
  padding: 8px 16px;
  font-family: var(--font-ui); font-size: var(--fs-2); font-weight: var(--fw-medium);
  cursor: pointer; white-space: nowrap;
  transition: box-shadow 120ms ease;
}
.google-signin-btn:hover { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15); }
.google-signin-btn:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
.google-signin-btn svg { flex-shrink: 0; }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `cd apps/desktop && npx vitest run --reporter=verbose 2>&1 | head -30`
Expected: Tests still pass (no CSS import errors, no missing mock errors)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/test/setup.ts apps/desktop/src/render/src/styles/meow.css
git commit -m "feat(ui): add OAuth card CSS classes and test mocks"
```

---

### Task 2: Write tests for the redesigned OAuthAccountsView

**Files:**
- Create: `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`

**Interfaces:**
- Consumes: OAuth mock methods from test setup (Task 1); `OAuthAccountMeta` type from `@shared/ipc`
- Produces: Test expectations that drive the implementation in Task 3

- [ ] **Step 1: Write the test file**

Create `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`:

```tsx
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
    await waitFor(() => expect(btn).toBeDisabled())
  })

  it('shows error banner on login failure', async () => {
    gw.oauthStartLogin.mockRejectedValue(new Error('auth failed'))
    render(<OAuthAccountsView />)
    fireEvent.click(await screen.findByRole('button', { name: /sign in with google/i }))
    expect(await screen.findByText('auth failed')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/render/src/views/OAuthAccountsView.test.tsx --reporter=verbose 2>&1 | tail -30`
Expected: Most tests FAIL because the current `OAuthAccountsView` doesn't have card layout, avatars, Pill badges, or Reconnect button yet.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx
git commit -m "test(ui): add OAuthAccountsView tests for card-based redesign"
```

---

### Task 3: Rewrite OAuthAccountsView component

**Files:**
- Modify: `apps/desktop/src/render/src/views/OAuthAccountsView.tsx` (full rewrite)

**Interfaces:**
- Consumes: `OAuthAccountMeta` from `@shared/ipc`; `ViewHeader`, `Button`, `Pill`, `ErrorBanner`, `EmptyState` from `../components/ui`; CSS classes from Task 1; `window.meowGateway.oauthStartLogin`, `oauthCompleteLogin`, `oauthListAccounts`, `oauthLogout`
- Produces: Fully rendered OAuth Connections view matching the spec

- [ ] **Step 1: Rewrite OAuthAccountsView.tsx**

Replace the entire contents of `apps/desktop/src/render/src/views/OAuthAccountsView.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { OAuthAccountMeta } from '@shared/ipc'
import { ViewHeader, Button, Pill, ErrorBanner, EmptyState } from '../components/ui'

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

  const refresh = useCallback(async () => {
    try {
      setAccounts(await window.meowGateway.oauthListAccounts(OAUTH_TYPE))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleSignIn() {
    setLoggingIn(true)
    setError(null)
    try {
      await window.meowGateway.oauthStartLogin(OAUTH_TYPE)
      await window.meowGateway.oauthCompleteLogin(OAUTH_TYPE)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleReconnect(providerId: string) {
    setLoggingIn(true)
    setError(null)
    try {
      await window.meowGateway.oauthStartLogin(OAUTH_TYPE)
      await window.meowGateway.oauthCompleteLogin(OAUTH_TYPE)
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
              <div className="oauth-card-actions">
                {!a.valid && (
                  <Button variant="primary" onClick={() => handleReconnect(a.providerId)} disabled={loggingIn}>
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
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run all tests**

Run: `cd apps/desktop && npx vitest run src/render/src/views/OAuthAccountsView.test.tsx --reporter=verbose`
Expected: All 10 tests PASS

- [ ] **Step 3: Run the full test suite to verify no regressions**

Run: `cd apps/desktop && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All existing tests still pass

- [ ] **Step 4: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | tail -20`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/views/OAuthAccountsView.tsx
git commit -m "feat(ui): redesign OAuth Connections with card layout, avatars, and Google button"
```
