# Antigravity Quota Display — UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group Antigravity quota bars into Claude/Gemini columns on each OAuth card and move the "Refresh quota" button below the account list, right-aligned and sized like the Google sign-in button.

**Architecture:** Introduce a dedicated `QuotaGroup` component that classifies `QuotaItem`s by `key` into four slots (`claude:5h`, `claude:weekly`, `gemini:5h`, `gemini:weekly`) and renders a two-column grid, reusing the existing `QuotaBar`. The view swaps its flat `items.map(...)` for `<QuotaGroup>`, removes the header refresh button, and adds a right-aligned refresh button below the list. CSS is updated and the duplicate quota blocks in `meow.css` are removed.

**Tech Stack:** React 18, TypeScript strict, Vitest + Testing Library, CSS custom properties.

## Global Constraints

- TypeScript strict mode.
- Do not change the IPC contract (`AntigravityQuotaData`, `QuotaItem`, channels) or the provider package.
- Files in `apps/desktop/src/render/src` use **CRLF** line endings — the `edit` tool fails on them; use `python` scripts with `\r\n` in anchors, or `cat >>` to append.
- `QuotaItem` type comes from `@meow-gateway/provider-antigravity` (fields: `key`, `label`, `percentage`, `resetTime`).
- `QuotaBar` takes a single prop `{ item: QuotaItem }`.
- `Button` supports `variant="ghost"`.
- CSS variables available: `--space-2`, `--fs-1`, `--fs-2`, `--fw-medium`, `--text`, `--text-dim`, `--green`, `--yellow`, `--red`, `--hairline`.
- `meow.css` currently contains **duplicate** `.oauth-quota-section`/`.quota-bar*` blocks (lines ~487-541) — remove the first (stale) copy and keep one clean set.

---

### Task 1: `QuotaGroup` component + tests

**Files:**
- Create: `apps/desktop/src/render/src/components/QuotaGroup.tsx`
- Create: `apps/desktop/src/render/src/components/QuotaGroup.test.tsx`

**Interfaces:**
- Consumes: `QuotaItem` from `@meow-gateway/provider-antigravity`; `QuotaBar` from `./QuotaBar`.
- Produces: `export function QuotaGroup({ items }: { items: QuotaItem[] })` — renders a `.quota-group` two-column grid with `.quota-column` (Claude) and `.quota-column` (Gemini), each containing a `.quota-column-title` and two `QuotaBar`s (5h then Weekly). A missing slot renders an empty `QuotaBar` at 100% with no reset label.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/render/src/components/QuotaGroup.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotaGroup } from './QuotaGroup'
import type { QuotaItem } from '@meow-gateway/provider-antigravity'

function item(key: string, label: string, percentage: number): QuotaItem {
  return { key, label, percentage, resetTime: '' }
}

const full = [
  item('claude:5h', 'Claude (5h)', 65),
  item('claude:weekly', 'Claude (Weekly)', 40),
  item('gemini:5h', 'Gemini (5h)', 20),
  item('gemini:weekly', 'Gemini (Weekly)', 80),
]

describe('QuotaGroup', () => {
  it('renders Claude and Gemini column titles', () => {
    render(<QuotaGroup items={full} />)
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('Gemini')).toBeTruthy()
  })

  it('renders all four bars with percentages', () => {
    render(<QuotaGroup items={full} />)
    expect(screen.getByText('65%')).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
  })

  it('renders empty 100% bars for missing slots', () => {
    render(<QuotaGroup items={[item('claude:5h', 'Claude (5h)', 65)]} />)
    // Claude weekly missing -> 100% bar; Gemini both missing -> 100% bars
    expect(screen.getAllByText('100%').length).toBe(3)
  })

  it('renders nothing when items is empty', () => {
    const { container } = render(<QuotaGroup items={[]} />)
    expect(container.querySelector('.quota-group')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test -- QuotaGroup`
Expected: FAIL — module `./QuotaGroup` not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/render/src/components/QuotaGroup.tsx`:

```tsx
import type { QuotaItem } from '@meow-gateway/provider-antigravity'
import { QuotaBar } from './QuotaBar'

type SlotKey = '5h' | 'weekly'

const COLUMNS: Array<{ title: string; prefix: string }> = [
  { title: 'Claude', prefix: 'claude' },
  { title: 'Gemini', prefix: 'gemini' },
]

const SLOTS: SlotKey[] = ['5h', 'weekly']

function emptyItem(key: string, label: string): QuotaItem {
  return { key, label, percentage: 100, resetTime: '' }
}

export function QuotaGroup({ items }: { items: QuotaItem[] }) {
  if (items.length === 0) return null
  const byKey = new Map(items.map((i) => [i.key, i]))
  return (
    <div className="quota-group">
      {COLUMNS.map((col) => (
        <div className="quota-column" key={col.title}>
          <div className="quota-column-title">{col.title}</div>
          {SLOTS.map((slot) => {
            const key = `${col.prefix}:${slot}`
            const found = byKey.get(key)
            const label = found ? found.label : `${col.title} (${slot === '5h' ? '5h' : 'Weekly'})`
            return <QuotaBar key={key} item={found ?? emptyItem(key, label)} />
          })}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test -- QuotaGroup`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/components/QuotaGroup.tsx apps/desktop/src/render/src/components/QuotaGroup.test.tsx
git commit -m "feat(render): add QuotaGroup two-column Claude/Gemini quota component"
```

---

### Task 2: Wire `QuotaGroup` into the view + move refresh button

**Files:**
- Modify: `apps/desktop/src/render/src/views/OAuthAccountsView.tsx`
- Modify: `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`

**Interfaces:**
- Consumes: `QuotaGroup` from `../components/QuotaGroup`; existing `quotaData`, `quotaRefreshing`, `refreshQuota` state/callbacks.
- Produces: view renders `<QuotaGroup items={quotaData[a.providerId].items} />`; "Refresh quota" button moved out of `ViewHeader` into a `.quota-refresh-row` below the `.oauth-grid`.

- [ ] **Step 1: Update the view**

Use a python script (CRLF-safe) to edit `apps/desktop/src/render/src/views/OAuthAccountsView.tsx`:

1. Add import: `import { QuotaGroup } from '../components/QuotaGroup'` (after the `QuotaBar` import line).
2. Remove the `QuotaBar` import line (no longer used directly).
3. Remove the refresh button from `ViewHeader` (the `<Button variant="ghost" onClick={refreshQuota} ...>` block).
4. Replace the flat bars block:
   ```tsx
   <div className="oauth-quota-bars">
     {quotaData[a.providerId].items.map((item) => (
       <QuotaBar key={item.key} item={item} />
     ))}
   </div>
   ```
   with:
   ```tsx
   <QuotaGroup items={quotaData[a.providerId].items} />
   ```
5. After the closing `</div>` of `.oauth-grid` (still inside the `.mt-4` div), add:
   ```tsx
   <div className="quota-refresh-row">
     <Button variant="ghost" onClick={refreshQuota} disabled={quotaRefreshing}>
       {quotaRefreshing ? 'Refreshing quota…' : 'Refresh quota'}
     </Button>
   </div>
   ```

- [ ] **Step 2: Update the view tests**

Append to `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx` (via `cat >>`):

```tsx

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

  it('Refresh quota button is below the account list', async () => {
    render(<OAuthAccountsView />)
    const btn = await screen.findByRole('button', { name: /refresh quota/i })
    const grid = document.querySelector('.oauth-grid')
    const row = document.querySelector('.quota-refresh-row')
    expect(grid).toBeTruthy()
    expect(row).toBeTruthy()
    expect(row?.contains(btn)).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd apps/desktop && pnpm test -- OAuthAccountsView`
Expected: PASS (all existing + new tests).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/views/OAuthAccountsView.tsx apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx
git commit -m "feat(render): group quota by model family and move refresh button below list"
```

---

### Task 3: CSS cleanup + new styles

**Files:**
- Modify: `apps/desktop/src/render/src/styles/meow.css`

**Interfaces:**
- Consumes: existing CSS variables.
- Produces: `.quota-group`, `.quota-column`, `.quota-column-title`, `.quota-refresh-row`; removes the duplicate quota block.

- [ ] **Step 1: Remove duplicate quota CSS**

The file currently has two copies of the `.oauth-quota-section`/`.quota-bar*` block (lines ~487-541). Use a python script to remove the **first** (stale) copy — the one using `var(--border)`, `var(--danger)`, `var(--muted)`, `var(--ok)`, `var(--warn)` — keeping the second copy that uses `var(--hairline)`, `var(--red)`, `var(--text-dim)`, `var(--green)`, `var(--yellow)`.

- [ ] **Step 2: Add new styles**

Append to `apps/desktop/src/render/src/styles/meow.css`:

```css
/* Quota group (two-column Claude/Gemini) */
.quota-group { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.quota-column { display: flex; flex-direction: column; gap: var(--space-2); }
.quota-column-title {
  font-size: var(--fs-2); font-weight: var(--fw-medium); color: var(--text-dim);
  text-transform: uppercase; letter-spacing: 0.04em;
}

/* Refresh quota row below the account list */
.quota-refresh-row {
  display: flex; justify-content: flex-end; margin-top: var(--space-3);
}
.quota-refresh-row .btn {
  padding: 8px 16px; font-size: var(--fs-2);
}
```

- [ ] **Step 3: Verify CSS is valid**

Run: `cd apps/desktop && pnpm lint`
Expected: PASS (no unused-variable or syntax errors).

- [ ] **Step 4: Run full render test suite**

Run: `cd apps/desktop && pnpm test`
Expected: PASS (all 41 test files).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/styles/meow.css
git commit -m "style(render): add quota group and refresh row styles, dedupe quota CSS"
```

---

### Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `cd apps/desktop && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `cd apps/desktop && pnpm test`
Expected: PASS (all 41 test files, including new `QuotaGroup` tests).

- [ ] **Step 4: Check acceptance criteria**

- [ ] Quota bars grouped into Claude/Gemini columns on each OAuth card.
- [ ] Missing model-family slot renders an empty bar (100%).
- [ ] "Refresh quota" button moved below the list, right-aligned, same size as the Google sign-in button.
- [ ] IPC contract and provider package unchanged.
- [ ] Unit tests pass; typecheck and lint pass.

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification pass for quota display refinement"
```
