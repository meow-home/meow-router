# UI Redesign & Common Components Specification

## Overview

This spec outlines the full UI redesign of **Meow Gateway** (`meow-router`), aligning its visual design, typography, layout, dual-theme engine (Dark/Light), icon system (`lucide-react`), and reusable common component architecture with **Meow Coding** (`meow-coding`).

## Goals

1. **Design System & Theme Engine**:
   - Standardize styling variables in `styles/meow.css` to match `meow-coding`'s VSCode Dark+ and Light+ palettes.
   - Implement `theme.ts` for managing theme state (`dark` | `light`), persisting to `localStorage` (`meow.theme`), setting `[data-theme]` on `<html>`, and synchronizing native title bar styling.
   - Integrate `lucide-react` for crisp vector icons across navigation, cards, tables, buttons, and status indicators.

2. **Common Reusable Components (`src/render/src/components/common/`)**:
   - `BaseModal`: Portal-based dialog overlay (`document.body`) with size options (`sm`, `md`, `lg`, `xl`), accessibility attributes, backdrop click / Escape key dismiss, and compound parts (`BaseModal.Header`, `BaseModal.Body`, `BaseModal.Footer`).
   - `BaseDropdown`: Smart popover overlay portaled to `document.body` with auto-flip positioning, viewport containment, and max-height scrolling.
   - `BaseSelect`: ARIA-compliant dropdown select control built on `BaseDropdown`.
   - `ConfirmDialog`: Standard confirmation modal built on `BaseModal`.
   - Reusable UI primitives in `ui.tsx`: `Button` (with variant icons), `Pill`/`Badge`, `Input`, `Toggle`, `Field`, `Panel`, `Card`, `EmptyState`.

3. **Views Redesign**:
   - **App Shell / Sidebar**: Header title bar with theme toggle, update status; Sidebar with Lucide icons, status pill, and clean navigation items.
   - **Gateway View**: High-impact control center card for starting/stopping the gateway, inline host/port configuration, master key generation, and routing policies.
   - **Providers View**: Provider cards with status indicators, test latency trigger (`Zap`), credential state, model counters, and updated `AddProviderModal`/`EditProviderModal`.
   - **Models View**: Searchable model table/cards with cost per 1M tokens (input/output), provider badges, and inline alias editing.
   - **Virtual Models View**: Visual routing chain builder for virtual models with fallback priorities.
   - **OAuth Accounts View**: Account status cards with `QuotaBar` and `QuotaGroup` progress indicators, token expiry badges, and refresh triggers.
   - **Dashboard / Usage View**: Metric summary cards (Requests, Tokens, Cost, Active Providers) and request log table with HTTP status pills and latency timers.

## Component Architecture & Interfaces

### 1. `BaseModal`
```tsx
export interface BaseModalProps {
  title?: ReactNode
  onClose?: () => void
  children?: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  role?: 'dialog' | 'alertdialog'
  className?: string
}
```

### 2. `BaseDropdown`
```tsx
export interface BaseDropdownProps {
  trigger: ReactNode | ((props: { open: boolean; toggle: () => void }) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: DropdownPlacement
  offset?: number
  containerClassName?: string
  menuClassName?: string
  children: ReactNode
  closeOnOutsideClick?: boolean
  closeOnEscape?: boolean
}
```

### 3. `BaseSelect`
```tsx
export interface BaseSelectOption {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export interface BaseSelectProps {
  value?: string
  defaultValue?: string
  options: BaseSelectOption[]
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}
```

## Theme Engine (`theme.ts`)

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

## Backward Compatibility & Testing Requirements

- All existing React unit tests (`App.test.tsx`, `Sidebar.test.tsx`, `ProvidersView.test.tsx`, etc.) must pass after redesign.
- IPC API contracts remain strictly unchanged.
- `npm run typecheck` and `npm test` must succeed.
