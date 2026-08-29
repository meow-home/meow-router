import { useEffect, useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { RouteStrip } from './components/RouteStrip'
import { ProvidersView } from './views/ProvidersView'
import { ModelsView } from './views/ModelsView'
import { VirtualModelsView } from './views/VirtualModelsView'
import { GatewayView } from './views/GatewayView'
import { DashboardView } from './views/DashboardView'
import type { ProviderWithCredential, VirtualModelRow } from '@shared/ipc'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('providers')
  const [running, setRunning] = useState<boolean>(false)
  const [providers, setProviders] = useState<ProviderWithCredential[]>([])
  const [activeModel, setActiveModel] = useState<VirtualModelRow | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      Promise.all([
        window.meowGateway.gatewayGetStatus(),
        window.meowGateway.listProviders(),
        window.meowGateway.listVirtualModels(),
      ])
        .then(([status, provs, vms]) => {
          if (cancelled) return
          setRunning(status.running)
          setProviders(provs)
          const active = vms.find((v) => v.enabled)
          setActiveModel(active ?? null)
        })
        .catch(() => {
          /* the foreground views surface their own errors */
        })

    refresh()
    const id = window.setInterval(refresh, 4000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar active={view} onSelect={setView} />
        <main className="app-main">
          <RouteStrip running={running} providers={providers} activeModel={activeModel} />
          <div style={{ height: 'var(--space-3)' }} />
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
