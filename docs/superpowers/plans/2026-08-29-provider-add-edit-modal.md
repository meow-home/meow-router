# Provider Add & Edit Popup Modals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "Add Provider" form with a popup modal and add a second popup modal to edit existing providers (display name, base URL, API key, enabled), without any backend/IPC changes.

**Architecture:** Pure renderer change. Two new focused components (`ProviderFields` shared field set, plus `AddProviderModal` and `EditProviderModal`) reuse the existing `Modal`/`Field`/`Select`/`Input`/`Checkbox` primitives. `ProvidersView` swaps its inline `showForm` boolean for `modal: 'add' | 'edit' | null` + `editing` state and wires the two modals.

**Tech Stack:** React + TypeScript (strict), Vitest + @testing-library/react, CSS tokens in `meow.css`.

## Global Constraints

- TypeScript strict mode. `noUnusedLocals`/`noUnusedParameters` are on — no unused imports/vars.
- Renderer must never read a raw API key. `setProviderCredential` is write-only; the renderer only knows `hasCredential: boolean`.
- `ProviderRow.type` is immutable after creation (backend + `updateProvider` rejects `type` changes). The Edit modal must disable the type select.
- Add/Edit modals: submit button disabled while `busy`, and errors render inside the modal (modal stays open on failure).
- Blank API key in Edit means "keep current credential" — must NOT call `setProviderCredential`.
- Tests required for every feature. Use the existing test patterns from `ProvidersView.test.tsx` (mock `window.meowGateway`, `vi.fn`, `waitFor`).

---

### Task 1: ProviderFields (shared form field component)

**Files:**
- Create: `apps/desktop/src/render/src/components/ProviderFields.tsx`
- Modify: none

**Interfaces:**
- Produces: `ProviderFields` — a controlled, non-submitting component.
  - Props: `{ types: ProviderTypeDescriptor[], type: string, setType: (v: string) => void, typeLocked?: boolean, displayName: string, setDisplayName: (v: string) => void, baseUrl: string, setBaseUrl: (v: string) => void, keyValue: string, setKeyValue: (v: string) => void, keyPlaceholder?: string, enabled: boolean, setEnabled: (v: boolean) => void, showEnabled?: boolean }`.
  - Renders a `div.form-grid` of `Field`/`Select`/`Input`/`Checkbox`. Type select disabled when `typeLocked`. Enabled checkbox rendered only when `showEnabled`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/render/src/components/ProviderFields.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProviderFields } from './ProviderFields'

const types = [{ id: 'openai', displayName: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', authType: 'bearer' }]

function renderFields(props: Partial<Parameters<typeof ProviderFields>[0]> = {}) {
  return render(
    <ProviderFields
      types={types}
      type="openai"
      setType={vi.fn()}
      displayName=""
      setDisplayName={vi.fn()}
      baseUrl=""
      setBaseUrl={vi.fn()}
      keyValue=""
      setKeyValue={vi.fn()}
      enabled
      setEnabled={vi.fn()}
      {...props}
    />
  )
}

describe('ProviderFields', () => {
  it('renders type select with options', () => {
    renderFields()
    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeTruthy()
  })

  it('disables type select when typeLocked', () => {
    renderFields({ typeLocked: true })
    expect((screen.getByLabelText('Type') as HTMLSelectElement).disabled).toBe(true)
  })

  it('hides enabled checkbox by default (add mode)', () => {
    renderFields()
    expect(screen.queryByLabelText('Enabled')).toBeNull()
  })

  it('shows enabled checkbox when showEnabled (edit mode)', () => {
    renderFields({ showEnabled: true })
    expect(screen.getByLabelText('Enabled')).toBeTruthy()
  })
})
```

Note: `Field` renders `<label className="field"><span className="field-label">{label}</span>...</label>`, so `getByLabelText('Type')` matches the `<select>` inside it via label association only if the `Field`/`Select` wiring associates properly. Use `screen.getByText('Type').parentElement` fallback if label association fails — see Step 3 note.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/components/ProviderFields.test.tsx`
Expected: FAIL (module `./ProviderFields` not found).

- [ ] **Step 3: Implement ProviderFields**

Create `apps/desktop/src/render/src/components/ProviderFields.tsx`:

```tsx
import type { ProviderTypeDescriptor } from '@shared/ipc'
import { Field, Select, Input, Checkbox } from './ui'

export function ProviderFields({
  types,
  type,
  setType,
  typeLocked = false,
  displayName,
  setDisplayName,
  baseUrl,
  setBaseUrl,
  keyValue,
  setKeyValue,
  keyPlaceholder = 'API key',
  enabled,
  setEnabled,
  showEnabled = false,
}: {
  types: ProviderTypeDescriptor[]
  type: string
  setType: (v: string) => void
  typeLocked?: boolean
  displayName: string
  setDisplayName: (v: string) => void
  baseUrl: string
  setBaseUrl: (v: string) => void
  keyValue: string
  setKeyValue: (v: string) => void
  keyPlaceholder?: string
  enabled: boolean
  setEnabled: (v: boolean) => void
  showEnabled?: boolean
}) {
  return (
    <div className="form-grid">
      <Field label="Type">
        <Select
          value={type}
          onChange={setType}
          disabled={typeLocked}
          options={types.map((t) => ({ value: t.id, label: t.displayName }))}
          className="provider-type"
        />
      </Field>
      <Field label="Display name">
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="Display name" />
      </Field>
      <Field label="Base URL">
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" aria-label="Base URL" />
      </Field>
      <Field label="API key">
        <Input type="password" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder={keyPlaceholder} aria-label="API key" autoComplete="off" />
      </Field>
      {showEnabled && (
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="provider-enabled">
          Enabled
        </Checkbox>
      )}
    </div>
  )
}
```

**Label-associated testing note:** `Field` renders a `<label>` wrapping an `<span>Label</span>` and the control, so `screen.getByLabelText('Type')` may not auto-resolve because the label text is inside a nested span. Give the `Select` an explicit `aria-label` (add `aria-label` prop to `Select` or pass through) so tests are robust. The simplest reliable approach: add an optional `aria-label` pass-through to `Select` in `ui.tsx` (Task 3 touches `ui.tsx`; for Task 1, instead match on the select's options and its `value`). Use `screen.getByRole('combobox')` to grab the select for the disabled test, and assert enabled checkbox via `getByRole('checkbox')` when `showEnabled`.

Adjust Step 1 test to use role-based queries:

```tsx
it('disables type select when typeLocked', () => {
  const { container } = renderFields({ typeLocked: true })
  expect(container.querySelector('select')?.disabled).toBe(true)
})

it('hides enabled checkbox by default (add mode)', () => {
  const { container } = renderFields()
  expect(container.querySelector('input[type="checkbox"]')).toBeNull()
})

it('shows enabled checkbox when showEnabled (edit mode)', () => {
  const { container } = renderFields({ showEnabled: true })
  expect(container.querySelector('input[type="checkbox"]')).toBeTruthy()
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/components/ProviderFields.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/components/ProviderFields.tsx apps/desktop/src/render/src/components/ProviderFields.test.tsx
git commit -m "feat(render): add ProviderFields shared form component"
```

---

### Task 2: AddProviderModal

**Files:**
- Create: `apps/desktop/src/render/src/components/AddProviderModal.tsx`
- Modify: none
- Test: `apps/desktop/src/render/src/components/AddProviderModal.test.tsx`

**Interfaces:**
- Consumes: `ProviderFields` (from Task 1), `Modal`, `Button`, `ErrorBanner` from `./ui`, and `types: ProviderTypeDescriptor[]`.
- Produces: `AddProviderModal` — props `{ open: boolean, types: ProviderTypeDescriptor[], onClose: () => void, onCreated: (p: ProviderRow) => void | Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/render/src/components/AddProviderModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AddProviderModal } from './AddProviderModal'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>
const types = [{ id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }]

describe('AddProviderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.createProvider.mockResolvedValue({ id: 'p2', type: 'deepseek', display_name: '', enabled: true, base_url: '', hasCredential: false, created_at: '', updated_at: '' })
    gw.setProviderCredential.mockResolvedValue(undefined)
  })

  it('does not render when closed', () => {
    const { container } = render(<AddProviderModal open={false} types={types} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(container.querySelector('.dialog')).toBeNull()
  })

  it('submits and calls createProvider then onCreated', async () => {
    const onCreated = vi.fn()
    render(<AddProviderModal open types={types} onClose={vi.fn()} onCreated={onCreated} />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'DeepSeek 2' } })
    fireEvent.change(inputs[1], { target: { value: 'https://api.example.com/v1' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: 'https://api.example.com/v1' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' })))
  })

  it('stores credential when a key is provided', async () => {
    render(<AddProviderModal open types={types} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'DeepSeek 2' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p2', 'sk-secret'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/components/AddProviderModal.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement AddProviderModal**

Create `apps/desktop/src/render/src/components/AddProviderModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ProviderRow, ProviderTypeDescriptor } from '@shared/ipc'
import { Modal, Button, ErrorBanner, ProviderFields } from './ui'

export function AddProviderModal({
  open,
  types,
  onClose,
  onCreated,
}: {
  open: boolean
  types: ProviderTypeDescriptor[]
  onClose: () => void
  onCreated: (p: ProviderRow) => void | Promise<void>
}) {
  const [type, setType] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Re-init to defaults whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setType(types[0]?.id ?? '')
    setDisplayName('')
    setBaseUrl('')
    setKeyValue('')
    setError(null)
    setBusy(false)
  }, [open, types])

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const created = await window.meowGateway.createProvider({
        type,
        display_name: displayName,
        base_url: baseUrl || undefined,
      })
      if (keyValue) await window.meowGateway.setProviderCredential(created.id, keyValue)
      await onCreated(created)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Add Provider" width={480} onClose={onClose}>
      <ProviderFields
        types={types}
        type={type}
        setType={setType}
        displayName={displayName}
        setDisplayName={setDisplayName}
        baseUrl={baseUrl}
        setBaseUrl={setBaseUrl}
        keyValue={keyValue}
        setKeyValue={setKeyValue}
        keyPlaceholder="API key"
        enabled
        setEnabled={() => {}}
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="dialog-actions" style={{ marginTop: 12 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} disabled={busy}>Save Provider</Button>
      </div>
    </Modal>
  )
}
```

Note: `ProviderFields` lives in `./ProviderFields`. Import it directly: `import { ProviderFields } from './ProviderFields'`. The `ErrorBanner` and other primitives come from `./ui`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/components/AddProviderModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/components/AddProviderModal.tsx apps/desktop/src/render/src/components/AddProviderModal.test.tsx
git commit -m "feat(render): add AddProviderModal popup"
```

---

### Task 3: EditProviderModal

**Files:**
- Create: `apps/desktop/src/render/src/components/EditProviderModal.tsx`
- Modify: `apps/desktop/src/render/src/components/ui.tsx` (add `aria-label` pass-through on `Select` if needed for label queries; otherwise none)
- Test: `apps/desktop/src/render/src/components/EditProviderModal.test.tsx`

**Interfaces:**
- Consumes: `ProviderFields`, `Modal`, `Button`, `ErrorBanner`, `Toggle` (optional) / `Checkbox` from `./ui`.
- Produces: `EditProviderModal` — props `{ open: boolean, provider: ProviderWithCredential | null, types: ProviderTypeDescriptor[], onClose: () => void, onUpdated: (p: ProviderRow) => void | Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/render/src/components/EditProviderModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditProviderModal } from './EditProviderModal'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>
const types = [{ id: 'deepseek', displayName: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', authType: 'bearer' }]
const provider = { id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true, base_url: 'https://api.deepseek.com/v1', hasCredential: true, created_at: '', updated_at: '' }

describe('EditProviderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.updateProvider.mockResolvedValue(provider)
    gw.setProviderCredential.mockResolvedValue(undefined)
  })

  it('does not render when closed', () => {
    const { container } = render(<EditProviderModal open={false} provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    expect(container.querySelector('.dialog')).toBeNull()
  })

  it('prefills and disables the type select, calls updateProvider with enabled', async () => {
    const { container } = render(<EditProviderModal open provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Enabled' }).checked).toBe(true)
    fireEvent.click(container.querySelector('input[type="checkbox"]') as HTMLInputElement)
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalledWith('p1', { display_name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', enabled: false }))
  })

  it('calls setProviderCredential when a new key is entered', async () => {
    render(<EditProviderModal open provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p1', 'sk-new'))
  })

  it('does NOT call setProviderCredential when key is blank', async () => {
    render(<EditProviderModal open provider={provider} types={types} onClose={vi.fn()} onUpdated={vi.fn()} />)
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.setProviderCredential).not.toHaveBeenCalled())
    await waitFor(() => expect(gw.updateProvider).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/components/EditProviderModal.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement EditProviderModal**

Create `apps/desktop/src/render/src/components/EditProviderModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ProviderRow, ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'
import { Modal, Button, ErrorBanner, ProviderFields } from './ui'

export function EditProviderModal({
  open,
  provider,
  types,
  onClose,
  onUpdated,
}: {
  open: boolean
  provider: ProviderWithCredential | null
  types: ProviderTypeDescriptor[]
  onClose: () => void
  onUpdated: (p: ProviderRow) => void | Promise<void>
}) {
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !provider) return
    setDisplayName(provider.display_name)
    setBaseUrl(provider.base_url ?? '')
    setKeyValue('')
    setEnabled(provider.enabled)
    setError(null)
    setBusy(false)
  }, [open, provider])

  async function handleSubmit() {
    if (!provider) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.meowGateway.updateProvider(provider.id, {
        display_name: displayName,
        base_url: baseUrl,
        enabled,
      })
      if (keyValue) await window.meowGateway.setProviderCredential(provider.id, keyValue)
      await onUpdated(updated)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Edit Provider" width={480} onClose={onClose}>
      {provider && (
        <>
          <ProviderFields
            types={types}
            type={provider.type}
            setType={() => {}}
            typeLocked
            displayName={displayName}
            setDisplayName={setDisplayName}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            keyValue={keyValue}
            setKeyValue={setKeyValue}
            keyPlaceholder={provider.hasCredential ? 'Leave blank to keep current key' : 'Enter API key'}
            enabled={enabled}
            setEnabled={setEnabled}
            showEnabled
          />
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="dialog-actions" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={busy}>Save Provider</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
```

Note: import `ProviderFields` from `./ProviderFields`, primitives from `./ui`. If `getByLabelText('API key')` does not resolve, add `aria-label` to the `Select`/`Input` in `ProviderFields` (already present on the API key Input via `aria-label="API key"`), and query the password field with `screen.getByPlaceholderText(...)` or `container.querySelector('input[type="password"]')` as a fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/components/EditProviderModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/render/src/components/EditProviderModal.tsx apps/desktop/src/render/src/components/EditProviderModal.test.tsx
git commit -m "feat(render): add EditProviderModal popup"
```

---

### Task 4: Wire modals into ProvidersView

**Files:**
- Modify: `apps/desktop/src/render/src/views/ProvidersView.tsx`
- Modify: `apps/desktop/src/render/src/views/ProvidersView.test.tsx`

**Interfaces:**
- Consumes: `AddProviderModal`, `EditProviderModal` (Tasks 2 & 3), `ProviderWithCredential`.
- Produces: updated `ProvidersView` behavior — no new exports.

- [ ] **Step 1: Update the failing test**

In `ProvidersView.test.tsx`, replace the last test ("adds a provider and stores credential") with modal-based assertions:

```tsx
  it('opens the add modal and stores credential', async () => {
    gw.createProvider.mockResolvedValue({ id: 'p2', type: 'deepseek', display_name: 'DeepSeek 2', enabled: true, base_url: '', hasCredential: false, created_at: '', updated_at: '' })
    gw.listProviders.mockResolvedValue([])
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Add Provider'))
    // modal opens
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const displayName = screen.getByLabelText('Display name')
    const apiKey = screen.getByLabelText('API key')
    fireEvent.change(displayName, { target: { value: 'DeepSeek 2' } })
    fireEvent.change(apiKey, { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByText('Save Provider'))
    await waitFor(() => expect(gw.createProvider).toHaveBeenCalledWith({ type: 'deepseek', display_name: 'DeepSeek 2', base_url: undefined }))
    await waitFor(() => expect(gw.setProviderCredential).toHaveBeenCalledWith('p2', 'sk-secret'))
  })

  it('opens the edit modal when Edit is clicked', async () => {
    render(<ProvidersView />)
    fireEvent.click(await screen.findByText('Edit'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // type select is disabled in edit mode
    const select = document.querySelector('.dialog select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
  })
```

Note: the `getByLabelText('Display name')` / `getByLabelText('API key')` resolution depends on how `Field` associates label text with the control. If these fail, query by role/text fallback: `screen.getByPlaceholderText(...)` or `document.querySelector('input')`. Adjust assertions to the actual DOM. Also add a row-level "Edit" button query: `await screen.findByText('Edit')` after providers load.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/views/ProvidersView.test.tsx`
Expected: FAIL (no Edit button yet; inline form behavior changed).

- [ ] **Step 3: Rewire ProvidersView state + render modals**

Modify `apps/desktop/src/render/src/views/ProvidersView.tsx`:

1. Replace `const [showForm, setShowForm] = useState(false)` with:

```tsx
const [modal, setModal] = useState<'add' | 'edit' | null>(null)
const [editing, setEditing] = useState<ProviderWithCredential | null>(null)
```

2. Replace the `handleAdd` form-submit function with add/edit handlers:

```tsx
async function handleCreated(created: ProviderRow) {
  setModal(null)
  setNotice('Provider added')
  await refresh()
}
async function handleUpdated(updated: ProviderRow) {
  setModal(null)
  setNotice('Provider updated')
  await refresh()
}
function openAdd() { setEditing(null); setModal('add') }
function openEdit(p: ProviderWithCredential) { setEditing(p); setModal('edit') }
```

3. Remove the inline `<form className="panel">...` block (the entire `showForm && (...)` form).

4. Replace the header Add button handler:

```tsx
<Button variant="primary" onClick={openAdd}>
  Add Provider
</Button>
```

5. Add an **Edit** button in each provider row's actions, before `Test`:

```tsx
<Button onClick={() => openEdit(p)}>Edit</Button>
<Button onClick={() => handleTest(p)}>Test</Button>
```

6. Render the two modals near the top-level notice `<Modal>`:

```tsx
<AddProviderModal open={modal === 'add'} types={types} onClose={() => setModal(null)} onCreated={handleCreated} />
<EditProviderModal open={modal === 'edit'} provider={editing} types={types} onClose={() => setModal(null)} onUpdated={handleUpdated} />
```

7. Add imports at top:

```tsx
import { AddProviderModal } from '../components/AddProviderModal'
import { EditProviderModal } from '../components/EditProviderModal'
import type { ProviderRow, ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'
```

Remove the now-unused inline form state (`showForm`) and the `handleAdd` function. Keep `Modal`, `Input`, `Select`, `Field` imports only if still used — otherwise remove unused imports to satisfy `noUnusedLocals`/lint.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meow-gateway/desktop test -- src/render/src/views/ProvidersView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `pnpm --filter @meow-gateway/desktop typecheck && pnpm --filter @meow-gateway/desktop lint && pnpm --filter @meow-gateway/desktop test`
Expected: all pass (typecheck, lint, and the full suite including the new modal tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/render/src/views/ProvidersView.tsx apps/desktop/src/render/src/views/ProvidersView.test.tsx
git commit -m "feat(render): replace inline add form with add/edit provider modals"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 ProviderFields → Task 1 ✓
- §3.2 AddProviderModal → Task 2 ✓
- §3.3 EditProviderModal (locked type, blank-key-keeps) → Task 3 ✓
- §3.4 ProvidersView wiring (modal state, Edit button, render modals) → Task 4 ✓
- §5 Tests (add opens/submits/create, edit prefill/disable type, setProviderCredential on new key, no credential on blank, enabled to updateProvider, backdrop not inner close via Modal tests) → Tasks 1–4 + existing `ui.test.tsx` covers Modal close behavior ✓

**2. Placeholder scan:** No TBD/TODO. Steps contain actual test and implementation code. The "adjust if label association fails" notes are concrete fallbacks, not placeholders. ✓

**3. Type consistency:** `ProviderWithCredential`, `ProviderRow`, `ProviderTypeDescriptor` match `@shared/ipc` re-exports. `ProviderFields` props consistent across Tasks 1, 2, 3. `AddProviderModal`/`EditProviderModal` props (`open`, `types`, `onClose`, `onCreated`/`onUpdated`, `provider`) consistent between Task 3 output and Task 4 usage. `window.meowGateway.createProvider`/`updateProvider`/`setProviderCredential` signatures match `WindowApi`. ✓

**4. Import correction:** Task 2 & 3 steps originally said `ProviderFields` comes from `./ui`; the implementation code import paths are corrected to `./ProviderFields`. Task 4 imports the two modals from `../components/`. ✓
