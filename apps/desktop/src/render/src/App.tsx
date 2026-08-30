import { useEffect, useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { UpdateModal } from './components/UpdateModal'
import { ProvidersView } from './views/ProvidersView'
import { ModelsView } from './views/ModelsView'
import { VirtualModelsView } from './views/VirtualModelsView'
import { GatewayView } from './views/GatewayView'
import { DashboardView } from './views/DashboardView'
import type { UpdateCheckResult, UpdateDownloadState } from '@shared/ipc'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('providers')
  const [running, setRunning] = useState<boolean>(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateDownloadState>({ status: 'idle' })

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

  useEffect(() => {
    let cancelled = false
    window.meowGateway.checkForUpdates()
      .then((res) => { if (!cancelled && res.hasUpdate) { setUpdateResult(res); setUpdateStatus({ status: 'idle' }); setUpdateOpen(true) } })
      .catch(() => {})
    const unsub = window.meowGateway.onUpdateReady(() => {
      if (!cancelled) { setUpdateResult((prev) => prev); setUpdateStatus({ status: 'downloaded', filePath: '' }); setUpdateOpen(true) }
    })
    return () => { cancelled = true; unsub() }
  }, [])

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar active={view} onSelect={setView} running={running} />
        <main className="app-main">
          {view === 'gateway' && <GatewayView />}
          {view === 'providers' && <ProvidersView />}
          {view === 'models' && <ModelsView />}
          {view === 'virtualmodels' && <VirtualModelsView />}
          {view === 'dashboard' && <DashboardView />}
        </main>
      </div>
      {updateResult && (
        <UpdateModal open={updateOpen} result={updateResult} status={updateStatus} onClose={() => setUpdateOpen(false)} />
      )}
    </div>
  )
}
