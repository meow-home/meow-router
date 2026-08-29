import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ModelRow, NewModel } from '@shared/ipc'
import { ViewHeader, Button, Field, EmptyState, Modal, Select, Input, Checkbox, ErrorBanner, ConfirmDialog, Pill } from '../components/ui'

interface Capabilities {
  streaming: boolean
  tools: boolean
  vision: boolean
  reasoning: boolean
  structuredOutput: boolean
}

const EMPTY_CAPS: Capabilities = {
  streaming: false,
  tools: false,
  vision: false,
  reasoning: false,
  structuredOutput: false,
}

function parseNullable(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function parseCapabilities(json: string | null): Capabilities {
  if (!json) return { ...EMPTY_CAPS }
  try {
    const parsed = JSON.parse(json) as Partial<Capabilities>
    return { ...EMPTY_CAPS, ...parsed }
  } catch {
    return { ...EMPTY_CAPS }
  }
}

const capabilityLabels: Array<{ key: keyof Capabilities; label: string }> = [
  { key: 'streaming', label: 'Streaming' },
  { key: 'tools', label: 'Tools' },
  { key: 'vision', label: 'Vision' },
  { key: 'reasoning', label: 'Reasoning' },
  { key: 'structuredOutput', label: 'Structured' },
]

interface ModelFormProps {
  open: boolean
  providers: ProviderWithCredential[]
  defaultProviderId: string
  model: ModelRow | null
  onSave: (input: NewModel) => Promise<void>
  onCancel: () => void
}

function ModelForm({ open, providers, defaultProviderId, model, onSave, onCancel }: ModelFormProps) {
  const [providerId, setProviderId] = useState(model?.provider_id ?? defaultProviderId)
  const [providerModelId, setProviderModelId] = useState(model?.provider_model_id ?? '')
  const [displayName, setDisplayName] = useState(model?.display_name ?? '')
  const [contextWindow, setContextWindow] = useState(model?.context_window?.toString() ?? '')
  const [inputPrice, setInputPrice] = useState(model?.input_price?.toString() ?? '')
  const [outputPrice, setOutputPrice] = useState(model?.output_price?.toString() ?? '')
  const [capabilities, setCapabilities] = useState<Capabilities>(() => parseCapabilities(model?.capabilities_json ?? null))
  const [enabled, setEnabled] = useState(model?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Re-initialise whenever the dialog opens (add) or the edit target changes.
  useEffect(() => {
    if (!open) return
    setProviderId(model?.provider_id ?? defaultProviderId)
    setProviderModelId(model?.provider_model_id ?? '')
    setDisplayName(model?.display_name ?? '')
    setContextWindow(model?.context_window?.toString() ?? '')
    setInputPrice(model?.input_price?.toString() ?? '')
    setOutputPrice(model?.output_price?.toString() ?? '')
    setCapabilities(parseCapabilities(model?.capabilities_json ?? null))
    setEnabled(model?.enabled ?? true)
    setError(null)
    setBusy(false)
  }, [open, model, defaultProviderId])

  function toggleCapability(key: keyof Capabilities) {
    setCapabilities((c) => ({ ...c, [key]: !c[key] }))
  }

  async function handleSave() {
    const input: NewModel = {
      provider_id: providerId,
      provider_model_id: providerModelId,
      display_name: displayName,
      context_window: parseNullable(contextWindow),
      input_price: parseNullable(inputPrice),
      output_price: parseNullable(outputPrice),
      capabilities_json: JSON.stringify(capabilities),
      enabled,
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(input)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={model ? 'Edit Model' : 'Add Model'}
      width={520}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save Model'}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Provider">
          <Select value={providerId} onChange={setProviderId} disabled={!!model} options={providers.map((p) => ({ value: p.id, label: p.display_name }))} />
        </Field>
        <Field label="Provider Model ID">
          <Input value={providerModelId} onChange={(e) => setProviderModelId(e.target.value)} />
        </Field>
        <Field label="Display Name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Context Window">
          <Input type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
        </Field>
        <Field label="Input Price">
          <Input type="number" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} />
        </Field>
        <Field label="Output Price">
          <Input type="number" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} />
        </Field>
      </div>

      <div style={{ marginTop: 'var(--space-3)' }}>
        <span className="field-label">Capabilities</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          {capabilityLabels.map(({ key, label }) => (
            <Checkbox key={key} checked={capabilities[key]} onChange={() => toggleCapability(key)}>
              {label}
            </Checkbox>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-2)' }}>
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
          Enabled
        </Checkbox>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
    </Modal>
  )
}

export function ModelsView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ModelRow | null>(null)

  const refresh = async (pid: string) => {
    if (!pid) { setModels([]); return }
    const rows = await window.meowGateway.listModelsByProvider(pid)
    setModels(rows)
  }

  useEffect(() => {
    window.meowGateway.listProviders().then((p) => {
      setProviders(p)
      if (p.length > 0) { setProviderId(p[0].id); refresh(p[0].id) }
    }).catch((e) => setError(String(e)))
  }, [])

  async function handleSyncModels() {
    await window.meowGateway.discoverModels(providerId)
    await refresh(providerId)
  }

  async function handleToggle(m: ModelRow) {
    await window.meowGateway.setModelEnabled(m.id, !m.enabled)
    await refresh(providerId)
  }

  async function handleConfirmDelete() {
    if (!deleting) return
    try {
      await window.meowGateway.deleteModel(deleting.id)
      setDeleting(null)
      await refresh(providerId)
    } catch (e) {
      setError(String(e))
      setDeleting(null)
    }
  }

  function handleAdd() {
    setEditTargetId(null)
    setShowForm(true)
  }

  function handleEdit(m: ModelRow) {
    setEditTargetId(m.id)
    setShowForm(true)
  }

  async function handleSaveModel(input: NewModel) {
    if (editTargetId) {
      // A model's provider is immutable after creation; strip provider_id from the patch
      // so updateModel does not reject it with INVALID_INPUT.
      const { provider_id: _providerId, ...patch } = input
      void _providerId
      await window.meowGateway.updateModel(editTargetId, patch)
    } else {
      await window.meowGateway.createModel(input)
    }
    setEditTargetId(null)
    setShowForm(false)
    await refresh(providerId)
  }

  function handleCancel() {
    setEditTargetId(null)
    setShowForm(false)
  }

  const editTarget = editTargetId ? models.find((m) => m.id === editTargetId) ?? null : null

  return (
    <div className="view">
      <ViewHeader title="Models" subtitle="The provider-facing model registry for the selected provider.">
        <Button onClick={handleSyncModels}>Sync Models</Button>
        <Button variant="primary" onClick={handleAdd}>Add Model</Button>
      </ViewHeader>

      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="field-label" style={{ whiteSpace: 'nowrap' }}>Provider</span>
        <Select
          value={providerId}
          onChange={(v) => { setProviderId(v); refresh(v) }}
          options={providers.map((p) => ({ value: p.id, label: p.display_name }))}
          className="provider-filter"
        />
        {error && <span className="mono" style={{ color: 'var(--fault)', fontSize: 'var(--fs-1)' }}>{error}</span>}
      </div>

      <ModelForm
        open={showForm}
        providers={providers}
        defaultProviderId={providerId}
        model={editTarget}
        onSave={handleSaveModel}
        onCancel={handleCancel}
      />

      {!showForm && models.length === 0 && (
        <EmptyState icon="◇" title="No models for this provider" hint="Run Sync Models or add one manually." />
      )}

      {models.length > 0 && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Model ID</th>
                <th>Context</th>
                <th>In</th>
                <th>Out</th>
                <th>Capabilities</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{m.display_name}</span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>{m.provider_model_id}</td>
                  <td className="mono">{m.context_window ?? '—'}</td>
                  <td className="mono">{m.input_price ?? '—'}</td>
                  <td className="mono">{m.output_price ?? '—'}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', maxWidth: 280 }}>
                      {capabilityLabels.map(({ key, label }) => (
                        <span key={key}>{label}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {m.stale && <Pill tone="warn">stale</Pill>}
                      <Pill tone={m.enabled ? 'ok' : 'muted'}>{m.enabled ? 'enabled' : 'disabled'}</Pill>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button onClick={() => handleEdit(m)}>Edit</Button>
                      <Button onClick={() => handleToggle(m)}>{m.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button variant="danger" onClick={() => setDeleting(m)}>Del</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete model"
        message={`Delete "${deleting?.display_name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
