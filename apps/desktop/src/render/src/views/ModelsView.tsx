import { useEffect, useState } from 'react'
import type { ProviderWithCredential, ModelRow, NewModel } from '@shared/ipc'

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

interface ModelFormProps {
  providers: ProviderWithCredential[]
  defaultProviderId: string
  model: ModelRow | null
  onSave: (input: NewModel) => Promise<void>
  onCancel: () => void
}

function ModelForm({ providers, defaultProviderId, model, onSave, onCancel }: ModelFormProps) {
  const [providerId, setProviderId] = useState(model?.provider_id ?? defaultProviderId)
  const [providerModelId, setProviderModelId] = useState(model?.provider_model_id ?? '')
  const [displayName, setDisplayName] = useState(model?.display_name ?? '')
  const [contextWindow, setContextWindow] = useState(model?.context_window?.toString() ?? '')
  const [inputPrice, setInputPrice] = useState(model?.input_price?.toString() ?? '')
  const [outputPrice, setOutputPrice] = useState(model?.output_price?.toString() ?? '')
  const [capabilities, setCapabilities] = useState<Capabilities>(() => parseCapabilities(model?.capabilities_json ?? null))
  const [enabled, setEnabled] = useState(model?.enabled ?? true)

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
    await onSave(input)
  }

  const capabilityLabels: Array<{ key: keyof Capabilities; label: string }> = [
    { key: 'streaming', label: 'Streaming' },
    { key: 'tools', label: 'Tools' },
    { key: 'vision', label: 'Vision' },
    { key: 'reasoning', label: 'Reasoning' },
    { key: 'structuredOutput', label: 'Structured Output' },
  ]

  return (
    <div style={{ border: '1px solid #2a3040', padding: 12, marginBottom: 12 }}>
      <label>
        Provider
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={!!model}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
      </label>
      <label>
        Provider Model ID
        <input value={providerModelId} onChange={(e) => setProviderModelId(e.target.value)} />
      </label>
      <label>
        Display Name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        Context Window
        <input type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
      </label>
      <label>
        Input Price
        <input type="number" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} />
      </label>
      <label>
        Output Price
        <input type="number" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} />
      </label>
      <fieldset>
        <legend>Capabilities</legend>
        {capabilityLabels.map(({ key, label }) => (
          <label key={key}>
            <input type="checkbox" checked={capabilities[key]} onChange={() => toggleCapability(key)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={handleSave}>Save Model</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function ModelsView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)

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

  async function handleDelete(m: ModelRow) {
    await window.meowGateway.deleteModel(m.id)
    await refresh(providerId)
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
    <section>
      <h2>Models</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={providerId} onChange={(e) => { setProviderId(e.target.value); refresh(e.target.value) }}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <button onClick={handleSyncModels}>Sync Models</button>
        <button onClick={handleAdd}>Add Model</button>
      </div>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      {showForm && (
        <ModelForm
          key={editTargetId ?? 'add'}
          providers={providers}
          defaultProviderId={providerId}
          model={editTarget}
          onSave={handleSaveModel}
          onCancel={handleCancel}
        />
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Name</th><th>Model ID</th><th>Context</th><th>In</th><th>Out</th><th>Capabilities</th><th>Stale</th><th>Enabled</th></tr></thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid #2a3040' }}>
              <td>{m.display_name}</td>
              <td>{m.provider_model_id}</td>
              <td>{m.context_window ?? '-'}</td>
              <td>{m.input_price ?? '-'}</td>
              <td>{m.output_price ?? '-'}</td>
              <td>{m.capabilities_json ?? '—'}</td>
              <td>{m.stale ? 'stale' : '—'}</td>
              <td>
                <button onClick={() => handleEdit(m)}>Edit</button>
                <button onClick={() => handleToggle(m)}>{m.enabled ? 'Disable' : 'Enable'}</button>
              </td>
              <td><button onClick={() => handleDelete(m)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
