import { useCallback, useEffect, useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { UpdateModal } from './components/UpdateModal'
import { ProvidersView } from './views/ProvidersView'
import { ModelsView } from './views/ModelsView'
import { VirtualModelsView } from './views/VirtualModelsView'
import { GatewayView } from './views/GatewayView'
import { DashboardView } from './views/DashboardView'
import type { UpdateCheckResult, UpdateDownloadState, UpdateDownloadAction } from '@shared/ipc'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('providers')
  const [running, setRunning] = useState<boolean>(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateDownloadState>({ status: 'idle' })
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const status = await window.meowGateway.gatewayGetStatus()
        if (!cancelled) setRunning(status.running)
      } catch {
        /* the Gateway view surfaces its own errors */
      }
    }
    refresh()
    const id = window.setInterval(refresh, 3000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  // Auto-check on launch: if an update is published, surface it to the user.
  useEffect(() => {
    let cancelled = false
    window.meowGateway.checkForUpdates()
      .then((res) => { if (!cancelled && res.hasUpdate) { setUpdateResult(res); setUpdateStatus({ status: 'idle' }); setUpdateOpen(true) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // A single `update:ready` subscription drives the downloaded state so the
  // modal can prompt the user to install.
  useEffect(() => {
    let cancelled = false
    const unsub = window.meowGateway.onUpdateReady(() => {
      if (!cancelled) { setUpdateStatus({ status: 'downloaded', filePath: '' }); setUpdateOpen(true) }
    })
    return () => { cancelled = true; unsub() }
  }, [])

  // Poll live download progress and surface failures/errors while downloading.
  useEffect(() => {
    if (updateStatus.status !== 'downloading') return
    const id = window.setInterval(async () => {
      try {
        const s = await window.meowGateway.getUpdateStatus()
        setUpdateStatus(s)
      } catch {
        /* swallowed; the next poll retries */
      }
    }, 500)
    return () => window.clearInterval(id)
  }, [updateStatus.status])

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true)
    try {
      const res = await window.meowGateway.checkForUpdates()
      setUpdateResult(res)
      setUpdateStatus({ status: 'idle' })
      setUpdateOpen(true)
    } catch {
      setUpdateResult({ latestVersion: '', currentVersion: '', hasUpdate: false, releaseUrl: '', releaseName: '', publishedAt: '' })
      setUpdateOpen(true)
    } finally {
      setChecking(false)
    }
  }, [])

  const handleDownload = useCallback((dl: UpdateDownloadAction) => {
    setUpdateStatus({ status: 'downloading', progress: 0 })
    window.meowGateway.startUpdateDownload(dl).catch((err) => {
      setUpdateStatus({ status: 'error', message: err instanceof Error ? err.message : 'Download failed' })
    })
  }, [])

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar active={view} onSelect={setView} running={running} checking={checking} onCheckUpdate={handleCheckUpdate} />
        <main className="app-main">
          {view === 'gateway' && <GatewayView />}
          {view === 'providers' && <ProvidersView />}
          {view === 'models' && <ModelsView />}
          {view === 'virtualmodels' && <VirtualModelsView />}
          {view === 'dashboard' && <DashboardView />}
        </main>
      </div>
      {updateResult && (
        <UpdateModal open={updateOpen} result={updateResult} status={updateStatus} onClose={() => setUpdateOpen(false)} onDownload={handleDownload} />
      )}
    </div>
  )
}
