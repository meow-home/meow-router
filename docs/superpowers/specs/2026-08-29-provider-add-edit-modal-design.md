# Design — Provider Add & Edit popup modals

Status: Approved (brainstorming)
Date: 2026-08-29
Scope owner: Meow Gateway

## 1. Problem

The Providers screen currently adds a provider via an **inline form** that expands under the header (`showForm` boolean). There is **no Edit** affordance at all — once a provider is created you can only toggle/delete it, so the only way to fix a wrong display name or base URL is delete + recreate. This is inconsistent with the model screens, which already have a proper add/edit modal form.

This feature replaces the inline add form with a **popup modal** for Add, and adds a **second popup modal** for Edit.

## 2. Goal

- Replace the inline "Add Provider" form with a `Modal`.
- Add an **Edit** action per provider that opens a modal prefilled with the provider's current values.
- Keep the same data flow: credentials go through the OS secure store via `setProviderCredential`, the renderer never reads a raw key back.

Non-goal: no IPC/backend changes. The existing `createProvider`, `updateProvider`, `setProviderCredential`, `deleteProvider` are sufficient. `type` is immutable after creation (backend constraint) — the Edit modal locks it.

## 3. Architecture

Pure renderer change. No changes to `shared/ipc.ts`, preload, main, or database.

### 3.1 New shared form field component

`ProviderFields` (in `components/ProviderFields.tsx`) is a **controlled, non-submitting** component that renders the form fields. It holds no submit logic. It accepts:

```ts
interface ProviderFieldsProps {
  types: ProviderTypeDescriptor[]
  type: string
  setType: (v: string) => void
  typeLocked?: boolean        // true in Edit; disables the type select
  displayName: string
  setDisplayName: (v: string) => void
  baseUrl: string
  setBaseUrl: (v: string) => void
  keyValue: string
  setKeyValue: (v: string) => void
  keyPlaceholder?: string
  enabled: boolean
  setEnabled: (v: boolean) => void
  showEnabled: boolean        // true in Edit; hidden in Add
}
```

Renders a `form-grid` with `Field` + `Select`/`Input`/`Checkbox`, reusing the existing `.field`, `.input`, `.check` classes from `meow.css`.

### 3.2 Add modal

`AddProviderModal` wraps `Modal`:

- Title **"Add Provider"**, width ~480px.
- Fields: Type (free, default = first type), Display name, Base URL, API key. Enabled is **not** shown (new providers default to enabled server-side; the row already has a toggle).
- Submit (`busy` state disables the button):
  1. `createProvider({ type, display_name, base_url })`
  2. if keyValue non-empty → `setProviderCredential(id, keyValue)`
  3. close modal, `refresh()`, `notice = 'Provider added'`
- Errors render inside the modal via `.error-banner`; the modal stays open on failure.

### 3.3 Edit modal

`EditProviderModal` wraps `Modal`:

- Title **"Edit Provider"**, width ~480px.
- Fields: Type (**locked**/disabled), Display name, Base URL, API key, **Enabled** (a `Checkbox`).
- API key: starts empty; placeholder text depends on whether the provider already has a credential — "Leave blank to keep current key" when `hasCredential` else "Enter API key".
- Submit (`busy` disables the button):
  1. `updateProvider(id, { display_name, base_url, enabled })`
  2. **if keyValue non-empty** → `setProviderCredential(id, keyValue)`; if blank, **no-op** (keeps existing key)
  3. close modal, `refresh()`, `notice = 'Provider updated'`
- Errors render inside the modal; stays open on failure.

### 3.4 ProvidersView wiring

- Replace `showForm: boolean` with `modal: 'add' | 'edit' | null` and `editing: ProviderWithCredential | null`.
- `Add Provider` button → `setModal('add')`.
- Each row gains an **Edit** button (beside `Test`). Action order per row: `Edit` · `Test` · `Sync Models` · `Delete`, plus the existing `Enable`/`Disable`.
- Render `<AddProviderModal open={modal === 'add'} ... />` and `<EditProviderModal open={modal === 'edit'} editing={editing} ... />`.

## 4. Behavior

- Both modals close on Esc, backdrop click, and the ✕ button (from the shared `Modal`).
- Save button disabled while `busy` (prevents double submit).
- The top-level `notice` `Modal` (for Test/Sync results) remains and is separate from add/edit modals.
- The empty-state "No providers yet" and its "Add Provider" affordance still work and open the add modal.

## 5. Tests

Add cases to a new `components/ProviderFormModal.test.tsx` (or extend `ProvidersView.test.tsx`):

- Add modal opens on "Add Provider", submit invokes `createProvider` with correct payload (type, display_name, base_url).
- Add with a key invokes `setProviderCredential` with the created id.
- Edit modal is prefilled with the provider's values; the type select is **disabled**.
- Edit with a new key invokes `setProviderCredential`.
- Edit with a **blank** key does **not** invoke `setProviderCredential` and still calls `updateProvider`.
- Edit passes `enabled` to `updateProvider`.
- Modal does not close on inner click, closes on backdrop click.

Update `ProvidersView.test.tsx`: the `Add Provider` click now opens a modal instead of expanding an inline form; assert the modal appears.

## 6. Docs

No IPC/type contract changes, so `docs/API.md` and `docs/DATA_MODEL.md` are unaffected. No database migration. If behavior around `setProviderCredential` (blank = keep) is worth documenting, note it in the design doc only.

## 7. Acceptance criteria

- [ ] Inline "Add Provider" form is replaced by a modal popup.
- [ ] Every provider row has an **Edit** action.
- [ ] Edit modal is prefilled; `type` is locked; blank key keeps the existing credential.
- [ ] Add/Edit both handle `busy` and in-modal errors.
- [ ] All existing + new unit tests pass; typecheck and lint pass.
- [ ] No secrets logged; renderer never reads a raw key.
