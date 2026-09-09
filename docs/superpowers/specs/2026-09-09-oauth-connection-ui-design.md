# OAuth Connection UI Redesign

**Date:** 2026-09-09  
**Scope:** Frontend only — `OAuthAccountsView.tsx` and `meow.css`  
**Backend changes:** None  

## Summary

Redesign the OAuth Accounts view from a plain list to a card-based layout with avatars, coloured status Pill badges, a Google-branded Sign-In button, and a Reconnect action for expired tokens.

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src/render/src/views/OAuthAccountsView.tsx` | Rewrite UI: card grid, avatar, Pill badges, Google button, Reconnect |
| `apps/desktop/src/render/src/styles/meow.css` | Add `.oauth-*` CSS classes |
| `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx` | New test file for the redesigned view |

## Component Hierarchy

```
OAuthAccountsView
├── ViewHeader
│   ├── Title: "OAuth Connections"
│   ├── Subtitle: "Providers that authenticate with a Google account instead of an API key."
│   └── GoogleSignInButton (branded)
├── ErrorBanner (conditional)
├── EmptyState (when accounts.length === 0)
└── .oauth-grid (CSS grid)
    └── .oauth-card × N
        ├── .oauth-avatar (circle, initial letter, gradient)
        ├── Info block: displayName, email
        ├── Pill (Connected tone=ok / Needs re-auth tone=warn)
        └── Actions: Reconnect (primary, only when valid===false) + Sign out (danger)
```

## Visual Specifications

### Google Sign-In Button

- Background: `#ffffff`, border: `1px solid #dadce0`, border-radius: `var(--radius)`
- Google "G" SVG logo (inline, 4-colour) — 18×18px, left-aligned with 12px gap
- Text: `"Sign in with Google"` — font-family: Roboto/system sans, colour `#3c4043`, font-weight 500
- Hover: `box-shadow: 0 1px 3px rgba(0,0,0,0.15)`
- Disabled state: opacity 0.45, text changes to `"Waiting for authorisation…"`

### OAuth Card (`.oauth-card`)

- Background: `var(--bg-panel)`
- Border: `1px solid var(--hairline)`
- Border-radius: `var(--radius)`
- Padding: `var(--space-3)` (16px)
- Layout: flex column
  - Top row: flex row — avatar (left), info (flex:1), pill (right)
  - Bottom row: flex end — action buttons

### Stale card modifier (`.oauth-card--stale`)

- Border-color: `rgba(255, 180, 84, 0.4)` (matches `--yellow` dim)
- Signals the account needs re-authentication

### Avatar (`.oauth-avatar`)

- Size: 40×40px, border-radius: 50%
- Background: `linear-gradient(135deg, #667eea, #764ba2)`
- Text: first letter of `displayName`, uppercase, white, bold, 16px
- Border: `2px solid rgba(255,255,255,0.1)`
- Flex-shrink: 0

### Card Grid (`.oauth-grid`)

- `display: grid`
- `grid-template-columns: repeat(auto-fill, minmax(340px, 1fr))`
- `gap: var(--space-2)`

## Interaction Design

### Sign-in Flow

1. User clicks Google Sign-In button → button disabled, text: "Waiting for authorisation…"
2. `oauthStartLogin(type)` opens system browser for Google consent
3. `oauthCompleteLogin(type)` waits for callback redirect
4. Success: new card appears with `meow-rise` animation, refresh account list
5. Error: `ErrorBanner` displays error message

### Reconnect Flow (for `valid === false` accounts)

1. User clicks "Reconnect" on a stale card
2. Same flow as sign-in: `oauthStartLogin` + `oauthCompleteLogin`
3. Success: card updates, Pill changes from warn to ok
4. Error: ErrorBanner

### Sign-out Flow

1. User clicks "Sign out" on any card
2. `oauthLogout(providerId)` called directly — no confirmation dialog
3. Card removed from grid; if no accounts remain, EmptyState shows

### Error Handling

- All async errors caught and displayed via `ErrorBanner`
- ErrorBanner uses existing shared component (no dismiss behaviour change)

## Testing Plan

New test file `OAuthAccountsView.test.tsx`:

1. **Renders card grid** with mock accounts — verifies `.oauth-card` elements
2. **Avatar initial** — first letter of displayName, uppercase
3. **Pill tone** — `ok` for valid accounts, `warn` for invalid
4. **Reconnect button visibility** — only shown when `valid === false`
5. **Sign out button** — always visible for valid accounts
6. **Google branded button** — rendered with correct text
7. **Empty state** — shown when no accounts
8. **Error banner** — shown when error state is set
9. **Loading state** — button disabled and text changes during sign-in

## Design Tokens Used (existing)

- `--bg-panel`, `--hairline`, `--radius`, `--space-3`, `--space-2`
- `--text-strong`, `--text-dim`, `--text-faint`
- `--green` (Pill ok), `--yellow` (Pill warn), `--red` (Button danger)
- `meow-rise` animation (entrance)
- Components: `ViewHeader`, `Button`, `Pill`, `ErrorBanner`, `EmptyState`

## Out of Scope

- No backend/IPC changes
- No avatar URL from Google (uses initial letter instead)
- No confirmation dialog for sign-out
- No token expiry display
- No support for additional OAuth providers beyond Antigravity
