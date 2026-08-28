import { useEffect, useState } from 'react'

export default function App(): JSX.Element {
  const [status, setStatus] = useState<string>('…')

  useEffect(() => {
    window.meowGateway?.ping().then((r) => setStatus(r.pong))
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e6e6e6', background: '#0b0e14', minHeight: '100vh' }}>
      <h1>Meow Gateway</h1>
      <p>Renderer ↔ Main IPC: <strong>{status}</strong></p>
    </div>
  )
}
