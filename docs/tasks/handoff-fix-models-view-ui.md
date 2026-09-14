# Handoff Prompt — Fix the Models screen visual layout (Meow Gateway renderer)

> Copy everything below the line into the coding agent of your choice.

---

## Role & context

You are working in the Monorepo `meow-gateway` (Electron desktop app, pnpm workspaces).

- Renderer app: `apps/desktop/src/render/src`
- Single global stylesheet: `apps/desktop/src/render/src/styles/meow.css` (plain CSS, **no** Tailwind, **no** CSS modules, **no** styled-components)
- Stack: React + TypeScript (strict), `electron-vite`, feature-first `views/*.tsx` + `components/ui.tsx` primitives
- Read first: `AGENTS.md`, `docs/UX_SPEC.md`, `apps/desktop/src/render/src/views/ModelsView.tsx`, `apps/desktop/src/render/src/styles/meow.css`

## Bug report (from a real screenshot of the running app)

Screen: **Models** view. The summary strip at the top of the page renders as unstyled stacked text, e.g. literally:

```
Active Provider🖼
Thanh Doan
27 registered models
Routing Status🖼
27 / 27
Active models enabled
Specialized Models🖼
54
27 Vision • 27 Reasoning
```

It is **not** three side-by-side cards, the lucide icons are glued to the right edge of the label text on the same line, the label is not uppercase/dimmed, values have no typographic weight, and the whole block is crammed against the left edge with no panel surface. The control bar below (`Provider` select + search + `Capabilities` chips) is also visibly mis-laid-out (chips row stays on the same flex line/wraps awkwardly instead of forming a clean second row separated by a hairline).

## Root cause (already diagnosed — verify, then fix)

Note: the broken styling comes from the **current uncommitted working tree** (`git status` shows `ModelsView.tsx` and `meow.css` modified on `main`), so do not chase these into old commits — the summary-card markup exists only in the working tree.

1. `ModelsView.tsx` renders these class names that **do not exist anywhere in `meow.css`**:

   - `analytics-grid` (wrapper)
   - `metric-card`
   - `metric-header`
   - `metric-title`
   - `metric-icon`
   - `metric-value`
   - `metric-subtitle`

   The uncommitted design pass added the markup but never added the CSS, so the markup falls back to default browser flow — that is exactly the screenshot.

2. `.models-control-bar` is defined **twice with conflicting layout** in `meow.css`, because the working-tree pass appended a new block while an older one from commit `8fb8f16` is still present:
   - ~line 712 (working tree, new): `display: flex; flex-direction: column; gap; background: var(--bg-raised)`
   - ~line 1250 (committed in `8fb8f16`, older): `display: flex; align-items: center; justify-content: space-between; background: var(--bg-panel)`

   The later rule wins by cascade order, which contradicts the markup intent (`.models-control-row` + `.models-capability-row` = a 2-row bar). Delete the obsolete one so the bar renders as intended.

3. The same append-only editing left `.capability-tag` defined twice (~line 799 with `px` values, ~line 1221 with the same values converted to `rem`). Keep a single definition using design tokens.

4. Other class names used in the renderer with **no CSS definition** (audit and fix the ones that matter, or delete the dead hooks):

   `gateway-hero-card` (GatewayView), `oauth-toolbar-info`, `oauth-type-select`, `mt-4`, `text-dim` (OAuthAccountsView), `provider-enabled` (ProviderFields), `provider-type` (ProviderFields/ProvidersView).

   Reproduce the audit with:

   ```bash
   cd apps/desktop/src/render/src
   grep -rho 'className="[^"{]*"' --include=*.tsx . | sed 's/className="//;s/"//' \
     | tr ' ' '\n' | sort -u \
     | while read c; do [ -n "$c" ] && ! grep -q -- "\.$c\([ ,{:.>)]\|$\)" styles/meow.css && echo "MISSING: $c"; done
   ```

### Pre-flight

`main` currently has ~18 dirty files (the in-progress UI redesign). Start by isolating the work so the fix is reviewable:

```bash
git status
git stash push -m "wip: ui redesign"   # or commit the current WIP first — your call, ask the human
```

Then re-apply/stash-pop or commit in reviewable steps so the reviewer sees a scoped diff for this bug.

## Task

Define the missing CSS (and clean up the conflicting one) so the Models screen summary + control bar match the existing Meow design system.

## Required outcome

**1. Summary strip = 3 responsive cards**

- `.analytics-grid`: CSS grid, 3 equal columns on desktop, collapsing to 1 column below ~640px, `gap: var(--space-3)` (the TSX already passes `marginBottom` inline — you may move it into the grid rule).
- `.metric-card`: same visual language as the existing `.provider-stat-card` (see `meow.css` ~line 1143) — `background: var(--bg-panel)`, `1px` hairline border, `--radius-lg`, `padding: var(--space-3) var(--space-4)`, `display: flex; flex-direction: column; gap`.
- `.metric-header`: `display: flex; align-items: center; justify-content: space-between; gap: var(--space-2)` — this is what stops the icon from being glued to the label text.
- `.metric-title`: uppercase, `var(--fs-0)`, `letter-spacing: 0.05em`, `var(--text-dim)`, `var(--fw-medium)` — mirror `.provider-stat-label`.
- `.metric-icon`: `flex-shrink: 0`, muted color (`var(--text-faint)` or the semantic color already applied inline).
- `.metric-value`: display font (`var(--font-display)`), `var(--fs-4)`, `var(--fw-semibold)`, `var(--text-strong)`, `line-height: 1.2`.
- `.metric-subtitle`: `var(--fs-1)`, `var(--text-dim)`.

**2. Remove inline-style hacks in `ModelsView.tsx`** that exist only to compensate for the missing CSS:

- `style={{ fontSize: '1.25rem' }}` on the provider-name value
- the inline `<span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: 400 }}>` for the `/ total` part of `Routing Status` (use a class, e.g. `.metric-value-total`)
- the inline uppercase/letter-spacing override on the `Capabilities` label (use a modifier class)
- `style={{ color: '#c084fc' }}` hard-coded purple on the `Specialized Models` icon — the design system mandates a near-monochrome VSCode-dark palette with a single dominant accent (`--accent: #007acc`). Either use an existing token (`var(--accent-strong)` / `var(--blue)`) or add a proper `--purple` token to **both** `:root` and `[data-theme="light"]`. Do not leave a raw hex in TSX.
- Prefer design tokens (`var(--space-*)`, `var(--fs-*)`, `var(--radius*)`) over the arbitrary `px` numbers currently sprinkled in TSX.

**3. Fix `.models-control-bar`**

- Keep exactly one definition (remove the stale `8fb8f16` block, ~line 1250). Desired layout: two rows inside one bordered panel — row 1 = `Provider` select + search input + `N models` count on the right, row 2 = `Capabilities` label + chip group, separated by a `1px` hairline (`border-top: 1px solid var(--hairline)` on `.models-capability-row`, which already has the rule).
- Ensure the chips (`.capability-chip`, including `is-active`) are vertically centered and baseline-consistent with the label; they currently look cramped/misaligned next to the monospace counter.
- Ensure the `N models` counter does not hug the search field: use `margin-left: auto` on the counter or `justify-content: space-between` on `.models-control-row`.

**4. Both themes must work**

`meow.css` ships a dark palette in `:root` and a light override under `[data-theme="light"]`. Any new token you add must be defined in both blocks. Do not hard-code backgrounds that only look right on dark.

## Constraints (from `AGENTS.md`)

- TypeScript strict; no `any` escalation.
- Do not rewrite unrelated files; keep the diff scoped to `models-view` styling + the missing-class audit you actually fix.
- Do not change any IPC contract, provider adapter, or gateway API behavior.
- Do not add a CSS framework or a new styling library.
- Renderer must not receive raw API keys (irrelevant here, but do not touch that boundary).
- If you delete a class hook from TSX, make sure nothing else references it.

## Acceptance criteria

- [ ] `analytics-grid` / `metric-*` classes exist in `meow.css` and are the only source of layout for those elements.
- [ ] Models summary renders as 3 side-by-side cards with label on the left and a muted icon pinned to the right on the same header row — no icon glued to the label text.
- [ ] `.models-control-bar` has a single definition; Provider + search on row 1, capability chips on row 2, chips and label vertically aligned.
- [ ] `.capability-tag` has a single definition (no px/rem duplicate).
- [ ] No raw `px` layout numbers or raw hex colors introduced in `ModelsView.tsx`; inline style hacks listed above are gone.
- [ ] Missing-class audit output is reduced to zero for every class that is actually needed (dead hooks removed instead).
- [ ] Light theme (`data-theme="light"`) renders correctly.
- [ ] Screenshot of the fixed Models view attached to the PR/commit description.

## Verification (run these, paste the output)

```bash
pnpm install
pnpm --filter @meow-gateway/desktop typecheck
pnpm --filter @meow-gateway/desktop lint
pnpm --filter @meow-gateway/desktop test
pnpm dev            # visually inspect the Models screen, dark + light theme
```

Tests to keep green (they query by text/label, so styling changes must not break selectors):
`apps/desktop/src/render/src/views/ModelsView.test.tsx`, `components/ui.test.tsx`, `App.test.tsx`.

Baseline at handoff time: `ModelsView.test.tsx` = 6/6 passing (`pnpm vitest run src/render/src/views/ModelsView.test.tsx`). Do not regress it.

## Deliverable format

Report back with:

1. Root cause confirmed (including the exact cascade conflict you found, if different from the diagnosis above).
2. Files changed + why.
3. Before/after screenshots of the Models screen.
4. Verification command output (typecheck / lint / test).
5. Any remaining visual risks you chose not to fix (e.g. other views with the same dead-class problem).
