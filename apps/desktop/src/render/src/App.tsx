import { useEffect, useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { ProvidersView } from './views/ProvidersView'
import { ModelsView } from './views/ModelsView'
import { VirtualModelsView } from './views/VirtualModelsView'
import { GatewayView } from './views/GatewayView'
import { DashboardView } from './views/DashboardView'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('providers')
  const [running, setRunning] = useState<boolean>(false)

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
    </div>
  )
}
