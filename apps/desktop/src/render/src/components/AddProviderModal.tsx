import { useEffect, useState } from 'react'
import type { ProviderRow, ProviderTypeDescriptor } from '@shared/ipc'
import { Modal, Button, ErrorBanner } from './ui'
import { ProviderFields } from './ProviderFields'

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
    setDisplayName(types[0]?.displayName ?? '')
    setBaseUrl('')
    setKeyValue('')
    setError(null)
    setBusy(false)
  }, [open, types])

  // The display name follows the type until the user makes it their own: an
  // empty field, or one still holding the outgoing type's name, is ours to
  // overwrite. Clearing the field opts back into the default.
  function handleTypeChange(next: string) {
    const outgoingDefault = types.find((t) => t.id === type)?.displayName ?? ''
    if (displayName === '' || displayName === outgoingDefault) {
      setDisplayName(types.find((t) => t.id === next)?.displayName ?? '')
    }
    setType(next)
  }

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
        setType={handleTypeChange}
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
