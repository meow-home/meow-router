import { useEffect, useState } from 'react'
import type { GatewayStatus, GatewayConfigRow } from '@shared/ipc'
import { ViewHeader, Button, Field, ErrorBanner, Pill, Input, Checkbox, Spinner } from '../components/ui'

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

  if (!status || !config) return <div className="view"><h2 className="view-title">Gateway</h2><Spinner label="Loading…" /></div>

  return (
    <div className="view">
      <ViewHeader title="Gateway" subtitle="Local OpenAI-compatible endpoint your coding agent talks to.">
        {status.running
          ? <Button variant="live" onClick={handleStop}>■ Stop</Button>
          : <Button variant="primary" onClick={handleStart}>▶ Start</Button>}
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderColor: status.running ? 'var(--live)' : 'var(--line)' }}>
        <Pill tone={status.running ? 'live' : 'muted'}>{status.running ? 'running' : 'stopped'}</Pill>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-3)', letterSpacing: '0.03em' }}>
            http://{status.host}:{status.port}/v1
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)' }}>
            Point an OpenAI-compatible client here to route through Meow Gateway.
          </div>
        </div>
        <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-0)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {status.running ? 'listening' : 'offline'}
        </span>
      </div>

      <div style={{ marginTop: 'var(--space-2)' }}>
        <form onSubmit={handleSave}>
          <div className="form-grid">
            <Field label="Host">
              <Input name="host" defaultValue={config.host} />
            </Field>
            <Field label="Port">
              <Input name="port" type="number" defaultValue={config.port} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            <Checkbox name="auth_enabled" defaultChecked={config.auth_enabled}>
              Require gateway API key
            </Checkbox>
            <Checkbox name="startup_enabled" defaultChecked={config.startup_enabled}>
              Start on launch
            </Checkbox>
          </div>
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 8 }}>
            <Button type="submit" variant="primary">Save config</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
