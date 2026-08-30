import { Modal, Button, Spinner } from './ui'
import type { UpdateCheckResult, UpdateDownloadState, UpdateDownloadAction } from '@shared/ipc'

export function UpdateModal({
  open,
  result,
  status,
  onClose,
  onInstall,
  onDownload,
}: {
  open: boolean
  result: UpdateCheckResult
  status: UpdateDownloadState
  onClose: () => void
  onInstall?: () => void
  onDownload?: (dl: UpdateDownloadAction) => void
}) {
  const downloading = status.status === 'downloading'
  const downloaded = status.status === 'downloaded'
  const errored = status.status === 'error'
  const canDownload = Boolean(result.downloadUrl && result.assetName)

  const handleDownload = () => {
    if (!result.downloadUrl || !result.assetName) return
    const dl: UpdateDownloadAction = { downloadUrl: result.downloadUrl, assetName: result.assetName, digest: result.digest }
    if (onDownload) onDownload(dl)
    else window.meowGateway.startUpdateDownload(dl)
  }

  return (
    <Modal open={open} title="Update" onClose={onClose}>
      {!result.hasUpdate && status.status === 'idle' && (
        <p className="dialog-message">
          You're on the latest version (v{result.currentVersion}).
        </p>
      )}
      {result.hasUpdate && !downloading && !downloaded && !errored && (
        <>
          <p className="dialog-message">
            A new version (v{result.latestVersion}) is available. You're on v{result.currentVersion}.
          </p>
          {canDownload ? (
            <div className="dialog-actions">
              <Button variant="primary" onClick={handleDownload}>
                Download & Install
              </Button>
            </div>
          ) : (
            <p className="dialog-message">No installer is available for your platform yet.</p>
          )}
        </>
      )}
      {downloading && <Spinner label={`Downloading ${Math.round(status.progress * 100)}%`} />}
      {downloaded && (
        <>
          <p className="dialog-message">Download complete. Install when ready.</p>
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => (onInstall ? onInstall() : window.meowGateway.openUpdateInstaller())}>Install Now</Button>
          </div>
        </>
      )}
      {errored && (
        <>
          <p className="dialog-message">Download failed: {status.message}</p>
          {canDownload && (
            <div className="dialog-actions">
              <Button variant="primary" onClick={handleDownload}>Retry</Button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
