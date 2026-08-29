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
