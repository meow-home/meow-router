# Antigravity Quota Display — UI Refinement Design

**Date:** 2026-09-09
**Status:** Approved
**Branch:** `feat/antigravity-quota-display`

## Problem

The current OAuth accounts view shows Antigravity quota as a flat list of
`QuotaBar`s with labels like "Claude (5h)", "Claude (Weekly)", "Gemini (5h)",
"Gemini (Weekly)". It is not visually obvious which model family (Claude vs
Gemini) each quota belongs to. Additionally, the "Refresh quota" button sits in
the `ViewHeader` next to the Google sign-in button and is smaller than it.

## Goals

1. Group quota bars by model family (Claude / Gemini) in a two-column layout,
   matching the reference project `D:\GitHub\cockpit-tools`.
2. Move the "Refresh quota" button below the account list, right-aligned, and
   make it the same size as the Google sign-in button.
3. Keep the IPC contract and provider package unchanged.

## Non-Goals

- No changes to `AntigravityQuotaData`, `QuotaItem`, IPC channels, or the
  provider parser.
- No changes to the polling interval or refresh logic.

## Approach

**Chosen: Approach A** — introduce a dedicated `QuotaGroup` component that
owns the grouping/render logic, keeping the view thin and the logic testable.

## Design

### 1. New component `QuotaGroup`

File: `apps/desktop/src/render/src/components/QuotaGroup.tsx`

- Props: `{ items: QuotaItem[] }`
- Classifies items by `item.key` into four slots:
  - `claude:5h`, `claude:weekly`, `gemini:5h`, `gemini:weekly`
- Renders a two-column grid:
  - Column **Claude** with a "5h" bar and a "Weekly" bar.
  - Column **Gemini** with a "5h" bar and a "Weekly" bar.
- A missing slot renders an empty bar at 100% (no reset label), mirroring the
  reference project's `renderBar` default of 100%.
- Reuses `QuotaBar` for each bar (keeps tone + reset-time logic).

### 2. `OAuthAccountsView.tsx` changes

- Remove the "Refresh quota" button from `ViewHeader`.
- Add a "Refresh quota" ghost button **below the account list, right-aligned**,
  sized to match the Google sign-in button.
- Replace the flat `items.map(...)` render with `<QuotaGroup items={...} />`.
- Keep state, 60s polling, `loadQuota`/`refreshQuota` unchanged.

### 3. CSS (`meow.css`)

- `.quota-group` — two-column grid.
- `.quota-column-title` — column heading (Claude / Gemini).
- `.quota-refresh-row` — right-aligned container below the list.
- Refresh button sized like `.google-signin-btn` (padding `8px 16px`, font
  `--fs-2`).

### 4. Tests

- `QuotaGroup.test.tsx`: classification of the four keys, two-column render,
  empty-bar fallback when a slot is missing.
- Update `OAuthAccountsView.test.tsx`: refresh button below the list, two-column
  Claude/Gemini render.

### 5. Error / empty handling (unchanged)

- `error` present → `.oauth-quota-error`.
- `items` empty → "No quota data".

## Acceptance Criteria

- [ ] Quota bars grouped into Claude / Gemini columns on each OAuth card.
- [ ] Missing model-family slot renders an empty bar (100%).
- [ ] "Refresh quota" button moved below the list, right-aligned, same size as
      the Google sign-in button.
- [ ] IPC contract and provider package unchanged.
- [ ] Unit tests pass; typecheck and lint pass.
