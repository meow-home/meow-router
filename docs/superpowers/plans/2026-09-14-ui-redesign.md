# UI Redesign & Common Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire functional UI of Meow Gateway (`meow-router`), adding a dual-theme engine (Dark/Light), integrating `lucide-react` icons, and building a reusable common component library (`BaseModal`, `BaseDropdown`, `BaseSelect`, etc.) styled to match `meow-coding`.

**Architecture:** Build common UI primitives in `src/render/src/components/common/` using React Portals to `document.body` for dialogs and popovers. Update global CSS variables in `styles/meow.css` for Dark/Light palettes. Refactor `ui.tsx` and all 6 views (`GatewayView`, `ProvidersView`, `ModelsView`, `VirtualModelsView`, `OAuthAccountsView`, `DashboardView`), `Sidebar`, and modals to consume the common component library.

**Tech Stack:** React 18, TypeScript (strict), Vite / electron-vite, `lucide-react`, Vitest, `@testing-library/react`.

## Global Constraints

- TypeScript strict mode.
- Maintain existing IPC API contracts without modification.
- Renderer MUST NOT import Node/Electron modules directly.
- Portaled popovers/modals MUST attach to `document.body`.
- Tests must pass (`npm run typecheck` and `npm test`).

---

### Task 1: Add `lucide-react` Dependency & Create Theme Engine

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/render/src/theme.ts`
- Modify: `apps/desktop/src/render/src/styles/meow.css`
- Modify: `apps/desktop/src/render/src/App.tsx`

**Interfaces:**
- Consumes: `localStorage` key `'meow.theme'`
- Produces: `getTheme()`, `applyTheme(theme?)`, `watchTheme(onChange?)`

- [ ] **Step 1: Install `lucide-react` in `apps/desktop`**

Run: `npm install lucide-react --workspace=apps/desktop`

- [ ] **Step 2: Create `theme.ts`**

Create `apps/desktop/src/render/src/theme.ts`:
```typescript
export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'meow.theme'

export function getTheme(): Theme {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme?: Theme): void {
  const resolved = theme ?? getTheme()
  document.documentElement.setAttribute('data-theme', resolved)
}

export function watchTheme(onChange?: (theme: Theme) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return
    const theme = getTheme()
    applyTheme(theme)
    onChange?.(theme)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
```

- [ ] **Step 3: Update `meow.css` with Light Theme tokens & metric CSS variables**

Add `[data-theme="light"]` token overrides and dropdown metric tokens (`--menu-radius`, `--menu-pad`, `--menu-item-h`, etc.) in `apps/desktop/src/render/src/styles/meow.css`.

- [ ] **Step 4: Initialize `applyTheme()` in `App.tsx`**

Call `applyTheme()` and setup `watchTheme()` on mount in `App.tsx`.

- [ ] **Step 5: Verify typecheck & test**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src/render/src/theme.ts apps/desktop/src/render/src/styles/meow.css apps/desktop/src/render/src/App.tsx
git commit -m "feat(ui): add lucide-react, theme engine, and light mode tokens"
```

---

### Task 2: Implement Common Components (`BaseModal`, `BaseDropdown`, `BaseSelect`)

**Files:**
- Create: `apps/desktop/src/render/src/components/common/BaseModal.tsx`
- Create: `apps/desktop/src/render/src/components/common/BaseDropdown.tsx`
- Create: `apps/desktop/src/render/src/components/common/BaseSelect.tsx`
- Modify: `apps/desktop/src/render/src/components/ui.tsx`

**Interfaces:**
- Produces: `BaseModal` (Header, Body, Footer), `BaseDropdown`, `BaseSelect`

- [ ] **Step 1: Create `BaseModal.tsx`**

Implement `BaseModal` with `createPortal(..., document.body)`, Escape key dismiss, backdrop click handling, size variants (`sm`, `md`, `lg`, `xl`), and compound `BaseModal.Header`, `BaseModal.Body`, `BaseModal.Footer`.

- [ ] **Step 2: Create `BaseDropdown.tsx`**

Implement `BaseDropdown` with `createPortal(..., document.body)`, position calculation (`bottom-start`, `bottom-end`, auto-flip vertical placement, max-height scrolling), outside click listener, and Escape key handling.

- [ ] **Step 3: Create `BaseSelect.tsx`**

Implement `BaseSelect` wrapping `BaseDropdown` with `role="combobox"`, option listing with `role="listbox"`, custom option icon support, and caret indicator.

- [ ] **Step 4: Update `ui.tsx` to wrap `BaseModal`, `BaseSelect`, and add Lucide-powered buttons & pills**

Refactor `Modal`, `ConfirmDialog`, and `Select` in `ui.tsx` to leverage `BaseModal`, `BaseDropdown`, and `BaseSelect`.

- [ ] **Step 5: Verify typecheck & test**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/src/components/common/ apps/desktop/src/render/src/components/ui.tsx
git commit -m "feat(ui): implement BaseModal, BaseDropdown, and BaseSelect common components"
```

---

### Task 3: Redesign Sidebar & App Header Navigation

**Files:**
- Modify: `apps/desktop/src/render/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/render/src/App.tsx`
- Test: `apps/desktop/src/render/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `View` state, `running` status, theme toggle handler
- Produces: Sidebar with Lucide icons (`Server`, `Layers`, `Cpu`, `Route`, `Key`, `BarChart3`, `Sun`, `Moon`), status badge, and theme switcher.

- [ ] **Step 1: Update `Sidebar.tsx` with Lucide icons and Theme Switcher**

Replace numeric text indices (`01`, `02`, ...) with Lucide icons (`Server`, `Layers`, `Cpu`, `Route`, `Key`, `BarChart3`). Add theme toggle button (`Sun` / `Moon`) next to Check Update in footer.

- [ ] **Step 2: Update `Sidebar.test.tsx`**

Ensure test suite passes with redesigned Sidebar elements.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/components/Sidebar.tsx apps/desktop/src/render/src/components/Sidebar.test.tsx
git commit -m "feat(ui): redesign Sidebar with Lucide icons and theme toggle"
```

---

### Task 4: Redesign Gateway View (`GatewayView`)

**Files:**
- Modify: `apps/desktop/src/render/src/views/GatewayView.tsx`
- Test: `apps/desktop/src/render/src/views/GatewayView.test.tsx`

**Interfaces:**
- Consumes: Gateway status, host/port settings, master key
- Produces: Control Center Hero Card, Master Key generator card with copy button, Active Routing Policies section.

- [ ] **Step 1: Redesign `GatewayView.tsx`**

Upgrade layout using `Panel`, `Card`, `Button`, `Input`, `Toggle`, `Pill`, and Lucide icons (`Zap`, `Server`, `Key`, `Globe`, `Copy`, `Check`, `RefreshCw`, `ShieldCheck`).

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/render/src/views/GatewayView.tsx
git commit -m "feat(ui): redesign GatewayView with control center hero card and Lucide icons"
```

---

### Task 5: Redesign Providers View & Modals (`ProvidersView`, `AddProviderModal`, `EditProviderModal`)

**Files:**
- Modify: `apps/desktop/src/render/src/views/ProvidersView.tsx`
- Modify: `apps/desktop/src/render/src/components/AddProviderModal.tsx`
- Modify: `apps/desktop/src/render/src/components/EditProviderModal.tsx`
- Modify: `apps/desktop/src/render/src/components/ProviderFields.tsx`
- Test: `apps/desktop/src/render/src/views/ProvidersView.test.tsx`
- Test: `apps/desktop/src/render/src/components/AddProviderModal.test.tsx`
- Test: `apps/desktop/src/render/src/components/EditProviderModal.test.tsx`

**Interfaces:**
- Consumes: Provider configs, credentials, test connection trigger
- Produces: Provider grid cards with latency ping (`Zap`), status toggle, modal dialogs powered by `BaseModal` and `BaseSelect`.

- [ ] **Step 1: Redesign `ProvidersView.tsx`**

Transform list into provider cards grid featuring brand badges, active pills, model counters, latency test buttons (`Zap`), and action menus.

- [ ] **Step 2: Redesign `AddProviderModal.tsx` & `EditProviderModal.tsx`**

Refactor dialogs to use `BaseModal` and `BaseSelect`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/views/ProvidersView.tsx apps/desktop/src/render/src/components/AddProviderModal.tsx apps/desktop/src/render/src/components/EditProviderModal.tsx apps/desktop/src/render/src/components/ProviderFields.tsx
git commit -m "feat(ui): redesign ProvidersView and provider modals with BaseModal and Lucide icons"
```

---

### Task 6: Redesign Models View & Virtual Models View

**Files:**
- Modify: `apps/desktop/src/render/src/views/ModelsView.tsx`
- Modify: `apps/desktop/src/render/src/views/VirtualModelsView.tsx`
- Modify: `apps/desktop/src/render/src/components/VirtualModelModal.tsx`
- Test: `apps/desktop/src/render/src/views/ModelsView.test.tsx`
- Test: `apps/desktop/src/render/src/views/VirtualModelsView.test.tsx`
- Test: `apps/desktop/src/render/src/components/VirtualModelModal.test.tsx`

- [ ] **Step 1: Redesign `ModelsView.tsx`**

Add catalog search bar, pricing badges ($/1M tokens), provider tags, and alias configuration modal.

- [ ] **Step 2: Redesign `VirtualModelsView.tsx` & `VirtualModelModal.tsx`**

Build visual fallback chain display showing primary provider and fallback order with `BaseModal` configuration.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/views/ModelsView.tsx apps/desktop/src/render/src/views/VirtualModelsView.tsx apps/desktop/src/render/src/components/VirtualModelModal.tsx
git commit -m "feat(ui): redesign ModelsView and VirtualModelsView with catalog search and fallback chains"
```

---

### Task 7: Redesign OAuth Accounts View & Dashboard View

**Files:**
- Modify: `apps/desktop/src/render/src/views/OAuthAccountsView.tsx`
- Modify: `apps/desktop/src/render/src/views/DashboardView.tsx`
- Test: `apps/desktop/src/render/src/views/OAuthAccountsView.test.tsx`
- Test: `apps/desktop/src/render/src/views/DashboardView.test.tsx`

- [ ] **Step 1: Redesign `OAuthAccountsView.tsx`**

Enhance quota displays (`QuotaBar`, `QuotaGroup`), status tags, token expiry badges, and re-auth buttons.

- [ ] **Step 2: Redesign `DashboardView.tsx`**

Build summary metrics cards (Requests, Tokens, Cost, Active Providers) and request log table with HTTP status code pills (200 OK, 401, 500) and response latency indicators.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/render/src/views/OAuthAccountsView.tsx apps/desktop/src/render/src/views/DashboardView.tsx
git commit -m "feat(ui): redesign OAuthAccountsView and DashboardView with stat cards and request log pills"
```

---

## Plan Self-Review

1. **Spec coverage**: Every requirement in `docs/superpowers/specs/2026-09-14-ui-redesign.md` is mapped to a task.
2. **Placeholder scan**: All code signatures and commands are explicitly specified.
3. **Type consistency**: Standard React/TypeScript types, `BaseModal`, `BaseDropdown`, and `BaseSelect` interfaces match.
