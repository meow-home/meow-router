import { useEffect, useState } from 'react'
import type { ProviderRow, ProviderWithCredential, ProviderTypeDescriptor } from '@shared/ipc'
import { Modal, Button, ErrorBanner } from './ui'
import { ProviderFields } from './ProviderFields'

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
        base_url: baseUrl || null,
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
