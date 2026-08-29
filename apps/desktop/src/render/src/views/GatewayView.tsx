import { useEffect, useState } from 'react'
import type { GatewayStatus, GatewayConfigRow } from '@shared/ipc'

export function GatewayView() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [config, setConfig] = useState<GatewayConfigRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const [s, c] = await Promise.all([window.meowGateway.gatewayGetStatus(), window.meowGateway.gatewayGetConfig()])
    setStatus(s); setConfig(c)
  }

  useEffect(() => { refresh().catch((e) => setError(String(e))) }, [])

  async function handleStart() { setStatus(await window.meowGateway.gatewayStart()) }
  async function handleStop() { setStatus(await window.meowGateway.gatewayStop()) }

  async function handleSave(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget)
    const port = Number(fd.get('port'))
    try {
      const saved = await window.meowGateway.gatewaySaveConfig({
        host: String(fd.get('host')),
        port,
        auth_enabled: fd.get('auth_enabled') === 'on',
        startup_enabled: fd.get('startup_enabled') === 'on'
      })
      setConfig(saved)
    } catch (e) { setError(String(e)) }
  }

  if (!status || !config) return <section><h2>Local Gateway</h2><p>Loading…</p></section>

  return (
    <section>
      <h2>Local Gateway</h2>
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <div style={{ marginBottom: 16 }}>
        <strong>{status.running ? 'Running' : 'Stopped'}</strong> — {status.host}:{status.port}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={handleStart}>Start</button>
        <button onClick={handleStop}>Stop</button>
      </div>
      <form onSubmit={handleSave} style={{ border: '1px solid #2a3040', padding: 16, borderRadius: 8 }}>
        <label>Host <input name="host" defaultValue={config.host} /></label>
        <label>Port <input name="port" type="number" defaultValue={config.port} /></label>
        <label><input name="auth_enabled" type="checkbox" defaultChecked={config.auth_enabled} /> Auth enabled</label>
        <label><input name="startup_enabled" type="checkbox" defaultChecked={config.startup_enabled} /> Startup enabled</label>
        <button type="submit">Save config</button>
      </form>
    </section>
  )
}
