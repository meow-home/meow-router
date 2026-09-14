import { useEffect, useState } from 'react'
import type { ProviderRow, ProviderTypeDescriptor } from '@shared/ipc'
import { BaseModal, Button, ErrorBanner } from './ui'
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
    <BaseModal open={open} onClose={onClose} width={500}>
      <BaseModal.Header
        title="Add Provider"
        subtitle="Connect a new AI provider to route model completions"
        onClose={onClose}
      />
      <BaseModal.Body>
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
      </BaseModal.Body>
      <BaseModal.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} disabled={busy}>Save Provider</Button>
      </BaseModal.Footer>
    </BaseModal>
  )
}
