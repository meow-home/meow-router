import { Modal, Button, Spinner } from './ui'
import type { UpdateCheckResult, UpdateDownloadState } from '@shared/ipc'

export function UpdateModal({
  open,
  result,
  status,
  onClose,
  onInstall,
}: {
  open: boolean
  result: UpdateCheckResult
  status: UpdateDownloadState
  onClose: () => void
  onInstall?: () => void
}) {
  const downloading = status.status === 'downloading'
  const downloaded = status.status === 'downloaded'
  const errored = status.status === 'error'

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
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => window.meowGateway.startUpdateDownload({ downloadUrl: result.downloadUrl!, assetName: result.assetName!, digest: result.digest })}>
              Download & Install
            </Button>
          </div>
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
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => window.meowGateway.startUpdateDownload({ downloadUrl: result.downloadUrl!, assetName: result.assetName!, digest: result.digest })}>Retry</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
