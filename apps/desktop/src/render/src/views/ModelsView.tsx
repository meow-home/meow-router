import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Edit3, Trash2, Cpu, Search, Zap, Wrench, Eye, Brain, Code2, MoreHorizontal, Power } from 'lucide-react'
import type { ProviderWithCredential, ModelRow, NewModel } from '@shared/ipc'
import { ViewHeader, Button, Field, EmptyState, BaseModal, BaseDropdown, Select, Input, BaseInput, Checkbox, ErrorBanner, ConfirmDialog, Pill } from '../components/ui'

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

const capabilityConfig: Array<{ key: keyof Capabilities; label: string; icon: React.ReactNode }> = [
  { key: 'streaming', label: 'Streaming', icon: <Zap size={12} /> },
  { key: 'tools', label: 'Tools', icon: <Wrench size={12} /> },
  { key: 'vision', label: 'Vision', icon: <Eye size={12} /> },
  { key: 'reasoning', label: 'Reasoning', icon: <Brain size={12} /> },
  { key: 'structuredOutput', label: 'Structured', icon: <Code2 size={12} /> },
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
    <BaseModal open={open} onClose={onCancel} width={540}>
      <BaseModal.Header
        title={model ? 'Edit Model' : 'Add Model'}
        subtitle={model ? `Configure model parameters for ${model.display_name}` : 'Register a new provider model'}
        onClose={onCancel}
      />
      <BaseModal.Body>
        <div className="form-grid">
          <Field label="Provider">
            <Select value={providerId} onChange={setProviderId} disabled={!!model} options={providers.map((p) => ({ value: p.id, label: p.display_name }))} />
          </Field>
          <Field label="Provider Model ID">
            <Input value={providerModelId} onChange={(e) => setProviderModelId(e.target.value)} aria-label="Provider Model ID" />
          </Field>
          <Field label="Display Name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="Display Name" />
          </Field>
          <Field label="Context Window">
            <Input type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} placeholder="e.g. 128000" aria-label="Context Window" />
          </Field>
          <Field label="Input Price ($/1M tokens)">
            <Input type="number" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} placeholder="0.00" aria-label="Input Price" />
          </Field>
          <Field label="Output Price ($/1M tokens)">
            <Input type="number" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} placeholder="0.00" aria-label="Output Price" />
          </Field>
        </div>

        <div style={{ marginTop: 'var(--space-3)' }}>
          <span className="field-label" style={{ marginBottom: 'var(--space-2)' }}>Supported Capabilities</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            {capabilityConfig.map(({ key, label, icon }) => (
              <Checkbox key={key} checked={capabilities[key]} onChange={() => toggleCapability(key)} aria-label={label}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {icon}
                  {label}
                </span>
              </Checkbox>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-3)' }}>
          <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
            Enabled for routing
          </Checkbox>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}
      </BaseModal.Body>
      <BaseModal.Footer>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save Model'}</Button>
      </BaseModal.Footer>
    </BaseModal>
  )
}

export function ModelsView() {
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [models, setModels] = useState<ModelRow[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [capabilityFilter, setCapabilityFilter] = useState<keyof Capabilities | 'all'>('all')
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

  const activeProvider = providers.find((p) => p.id === providerId)
  const enabledCount = models.filter((m) => m.enabled).length
  const visionCount = models.filter((m) => parseCapabilities(m.capabilities_json).vision).length
  const reasoningCount = models.filter((m) => parseCapabilities(m.capabilities_json).reasoning).length

  const filteredModels = models.filter((m) => {
    const caps = parseCapabilities(m.capabilities_json)
    if (capabilityFilter !== 'all' && !caps[capabilityFilter]) return false
    if (!searchFilter.trim()) return true
    const q = searchFilter.toLowerCase()
    return m.display_name.toLowerCase().includes(q) || m.provider_model_id.toLowerCase().includes(q)
  })

  return (
    <div className="view">
      <ViewHeader title="Models" subtitle="The provider-facing model registry for the selected provider.">
        <Button onClick={handleSyncModels}>
          <RefreshCw size={13} style={{ marginRight: '6px' }} />
          Sync Models
        </Button>
        <Button variant="primary" onClick={handleAdd}>
          <Plus size={14} style={{ marginRight: '6px' }} />
          Add Model
        </Button>
      </ViewHeader>

      {/* Provider Summary Cards */}
      {models.length > 0 && (
        <div className="models-summary-grid">
          <div className="models-metric-card">
            <div className="models-metric-header">
              <span className="models-metric-title">Active Provider</span>
              <Cpu size={16} className="models-metric-icon" />
            </div>
            <div className="models-metric-value" style={{ fontSize: '1.25rem' }}>{activeProvider?.display_name ?? '—'}</div>
            <div className="models-metric-subtitle">{models.length} registered models</div>
          </div>

          <div className="models-metric-card">
            <div className="models-metric-header">
              <span className="models-metric-title">Routing Status</span>
              <Power size={16} className="models-metric-icon" style={{ color: 'var(--green)' }} />
            </div>
            <div className="models-metric-value">{enabledCount} <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: 400 }}>/ {models.length}</span></div>
            <div className="models-metric-subtitle">Active models enabled</div>
          </div>

          <div className="models-metric-card">
            <div className="models-metric-header">
              <span className="models-metric-title">Specialized Models</span>
              <Brain size={16} className="models-metric-icon" style={{ color: '#c084fc' }} />
            </div>
            <div className="models-metric-value">{reasoningCount + visionCount}</div>
            <div className="models-metric-subtitle">{visionCount} Vision • {reasoningCount} Reasoning</div>
          </div>
        </div>
      )}

      {/* Control Bar: Provider Selector + Search + Capability Filters (All Left-Aligned) */}
      <div className="models-control-bar">
        <div className="models-control-row">
          <div className="models-control-left">
            <div className="models-provider-select-wrapper">
              <span className="models-provider-label">Provider</span>
              <Select
                value={providerId}
                onChange={(v) => { setProviderId(v); refresh(v) }}
                options={providers.map((p) => ({ value: p.id, label: p.display_name }))}
                style={{ width: 160 }}
              />
            </div>

            <BaseInput
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter models by name or ID..."
              leftIcon={<Search size={14} />}
              clearable
              onClear={() => setSearchFilter('')}
              style={{ width: 220 }}
            />

            <div className="models-capability-filters">
              <button
                type="button"
                className={`capability-chip ${capabilityFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setCapabilityFilter('all')}
              >
                All
              </button>
              {capabilityConfig.map(({ key, label, icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`capability-chip ${capabilityFilter === key ? 'is-active' : ''}`}
                  onClick={() => setCapabilityFilter(key)}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)', flexShrink: 0 }}>
            {filteredModels.length} models
          </div>
        </div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <ModelForm
        open={showForm}
        providers={providers}
        defaultProviderId={providerId}
        model={editTarget}
        onSave={handleSaveModel}
        onCancel={handleCancel}
      />

      {!showForm && filteredModels.length === 0 && (
        <EmptyState
          icon="◇"
          title="No models found"
          hint={
            searchFilter || capabilityFilter !== 'all'
              ? 'No models match the active filter criteria.'
              : 'Run Sync Models or add one manually.'
          }
        >
          {(searchFilter || capabilityFilter !== 'all') && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearchFilter('')
                setCapabilityFilter('all')
              }}
              style={{ marginTop: 'var(--space-2)' }}
            >
              Reset Filters
            </Button>
          )}
        </EmptyState>
      )}

      {filteredModels.length > 0 && (
        <div className="panel table-scroll-container" style={{ padding: 0 }}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Model</th>
                <th>Context</th>
                <th>Pricing ($/1M)</th>
                <th>Capabilities</th>
                <th>Status</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((m) => {
                const caps = parseCapabilities(m.capabilities_json)
                const hasCaps = capabilityConfig.some(({ key }) => caps[key])

                return (
                  <tr key={m.id}>
                    <td>
                      <div className="model-cell-identity">
                        <Cpu size={15} style={{ color: 'var(--accent-strong)', flexShrink: 0 }} />
                        <div className="model-cell-names">
                          <span className="model-cell-title">{m.display_name}</span>
                          <span className="model-cell-sub">{m.provider_model_id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {m.context_window ? (
                        <span style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-1)' }}>
                          {m.context_window >= 1000 ? `${(m.context_window / 1000).toLocaleString()}K tok` : `${m.context_window} tok`}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div className="price-chip">
                        <span>In: <span className="price-tag">${m.input_price ?? '0'}</span></span>
                        <span style={{ color: 'var(--text-faint)' }}>/</span>
                        <span>Out: <span className="price-tag">${m.output_price ?? '0'}</span></span>
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {hasCaps ? (
                        <div className="capability-tags-compact">
                          {capabilityConfig.map(({ key, label, icon }) => {
                            if (!caps[key]) return null
                            return (
                              <span key={key} className={`capability-tag capability--${key} is-active`} style={{ whiteSpace: 'nowrap' }}>
                                {icon}
                                {label}
                              </span>
                            )
                          })}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
                        {m.stale && <Pill tone="warn">stale</Pill>}
                        <Pill tone={m.enabled ? 'ok' : 'muted'}>{m.enabled ? 'enabled' : 'disabled'}</Pill>
                      </div>
                    </td>
                    <td className="col-actions" style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <BaseDropdown
                          placement="bottom-end"
                          trigger={
                            <Button variant="ghost" title="Actions" aria-label="Actions" style={{ padding: '2px 6px' }}>
                              <MoreHorizontal size={15} />
                            </Button>
                          }
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130 }}>
                            <button
                              type="button"
                              className="select-option"
                              onClick={() => handleEdit(m)}
                            >
                              <Edit3 size={13} style={{ marginRight: '6px' }} />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="select-option"
                              onClick={() => handleToggle(m)}
                            >
                              <Power size={13} style={{ marginRight: '6px' }} />
                              {m.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              className="select-option"
                              style={{ color: 'var(--red)' }}
                              onClick={() => setDeleting(m)}
                            >
                              <Trash2 size={13} style={{ marginRight: '6px' }} />
                              Del
                            </button>
                          </div>
                        </BaseDropdown>
                      </div>
                    </td>
                  </tr>
                )
              })}
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
