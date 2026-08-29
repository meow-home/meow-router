import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ModelRow, VirtualModelRow } from '@shared/ipc'
import { Modal, Button, Field, Select, Input, ErrorBanner, Spinner } from './ui'

export function VirtualModelModal({
  open,
  providers,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  providers: ProviderWithCredential[]
  // When set, the modal edits this virtual model; otherwise it creates a new one.
  initial?: VirtualModelRow | null
  onClose: () => void
  onSaved: (vm: VirtualModelRow) => void | Promise<void>
}) {
  const [displayName, setDisplayName] = useState('')
  const [providerId, setProviderId] = useState('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [providerModelId, setProviderModelId] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editing = !!initial

  // Re-init whenever the modal opens. For a new model default to the first
  // provider; for an edit, seed from the existing virtual model.
  useEffect(() => {
    if (!open) return
    setDisplayName(initial?.display_name ?? '')
    setProviderId(initial?.provider_id ?? providers[0]?.id ?? '')
    setProviderModelId(initial?.provider_model_id ?? '')
    setModels([])
    setError(null)
    setBusy(false)
  }, [open, providers, initial])

  // Fetch the provider's model list whenever the selected provider changes so
  // the operator picks a real model id instead of typing one freehand.
  useEffect(() => {
    if (!open || !providerId) {
      setModels([])
      return
    }
    let cancelled = false
    setLoadingModels(true)
    window.meowGateway
      .listModelsByProvider(providerId)
      .then((rows) => {
        if (cancelled) return
        setModels(rows)
        // New model: auto-select the first so the operator can submit immediately.
        // Edit: keep the existing selection even if it is absent from the list.
        setProviderModelId((current) => current || (rows.length > 0 ? rows[0].provider_model_id : ''))
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, providerId])

  async function handleSave() {
    setBusy(true)
    setError(null)
    const payload = {
      display_name: displayName,
      provider_id: providerId,
      provider_model_id: providerModelId,
      routing_policy_id: null,
    }
    try {
      const saved = editing
        ? await window.meowGateway.updateVirtualModel(initial!.id, payload)
        : await window.meowGateway.createVirtualModel(payload)
      await onSaved(saved!)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  // Keep the currently selected/provided model id in the options even when the
  // provider list does not yet contain it, so editing never silently clears it.
  const modelOptions = models.map((m) => ({ value: m.provider_model_id, label: m.provider_model_id }))
  if (providerModelId && !modelOptions.some((o) => o.value === providerModelId)) {
    modelOptions.unshift({ value: providerModelId, label: providerModelId })
  }

  return (
    <Modal open={open} title={editing ? 'Edit Virtual Model' : 'New Virtual Model'} width={480} onClose={onClose}>
      <div className="form-grid">
        <Field label="Public model name">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            aria-label="Public model name"
            placeholder="meow-coding"
          />
        </Field>
        <Field label="Provider">
          <Select
            value={providerId}
            onChange={setProviderId}
            options={providers.map((p) => ({ value: p.id, label: p.display_name }))}
            required
            placeholder="Select a provider"
          />
        </Field>
        <Field label="Provider model id">
          {loadingModels ? (
            <Spinner label="Loading models…" />
          ) : (
            <Select
              value={providerModelId}
              onChange={setProviderModelId}
              options={modelOptions}
              required
              disabled={modelOptions.length === 0}
              placeholder={modelOptions.length === 0 ? 'No configured models' : 'Select a provider model'}
            />
          )}
        </Field>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="dialog-actions" style={{ marginTop: 12 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={busy || loadingModels || !providerModelId}>
          {busy ? 'Saving…' : editing ? 'Save Changes' : 'Save Virtual Model'}
        </Button>
      </div>
    </Modal>
  )
}
