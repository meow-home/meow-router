import { useState } from 'react'
import { Sidebar, type View } from './components/Sidebar'
import { ProvidersView } from './views/ProvidersView'
import { ModelsView } from './views/ModelsView'
import { VirtualModelsView } from './views/VirtualModelsView'
import { GatewayView } from './views/GatewayView'
import { DashboardView } from './views/DashboardView'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('providers')

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0b0e14', color: '#e6e6e6', fontFamily: 'monospace' }}>
      <Sidebar active={view} onSelect={setView} />
      <main style={{ flex: 1, padding: 24 }}>
        {view === 'providers' && <ProvidersView />}
        {view === 'models' && <ModelsView />}
        {view === 'virtualmodels' && <VirtualModelsView />}
        {view === 'gateway' && <GatewayView />}
        {view === 'dashboard' && <DashboardView />}
      </main>
    </div>
  )
}
