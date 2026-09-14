import { useEffect, useState } from 'react'
import { Play, Square, Copy, RefreshCw, Check, Key, Server } from 'lucide-react'
import type { GatewayStatus, GatewayConfigRow, GatewayKeyInfo } from '@shared/ipc'
import { ViewHeader, Button, Field, ErrorBanner, Pill, Input, Checkbox, Spinner, ConfirmDialog, Panel } from '../components/ui'

export function GatewayView() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [config, setConfig] = useState<GatewayConfigRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyInfo, setKeyInfo] = useState<GatewayKeyInfo | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = async () => {
    const [s, c, k] = await Promise.all([
      window.meowGateway.gatewayGetStatus(),
      window.meowGateway.gatewayGetConfig(),
      window.meowGateway.gatewayGetKeyInfo()
    ])
    setStatus(s); setConfig(c); setKeyInfo(k)
  }

  useEffect(() => { refresh().catch((e) => setError(String(e))) }, [])

  async function handleStart() { setStatus(await window.meowGateway.gatewayStart()) }
  async function handleStop() { setStatus(await window.meowGateway.gatewayStop()) }

  async function handleCopyKey() {
    try {
      await window.meowGateway.gatewayCopyKey()
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) { setError(String(e)) }
  }

  async function handleRegenerate() {
    setConfirmRegen(false)
    try { setKeyInfo(await window.meowGateway.gatewayRegenerateKey()) } catch (e) { setError(String(e)) }
  }

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
          ? <Button variant="live" onClick={handleStop}><Square size={14} style={{ marginRight: '6px' }} /> Stop</Button>
          : <Button variant="primary" onClick={handleStart}><Play size={14} style={{ marginRight: '6px' }} /> Start</Button>}
      </ViewHeader>

      <ErrorBanner>{error}</ErrorBanner>

      <Panel className="gateway-hero-card" style={{ padding: 'var(--space-4)', borderColor: status.running ? 'var(--green-dim)' : 'var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div className={`status-badge-icon ${status.running ? 'is-running' : ''}`} style={{
            width: '44px', height: '44px', borderRadius: 'var(--radius)',
            background: status.running ? 'var(--accent-dim)' : 'var(--bg-hover)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: status.running ? 'var(--green)' : 'var(--text-dim)'
          }}>
            <Server size={24} style={{ margin: 'auto' }} />
          </div>
          
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div className="mono" style={{ fontSize: 'var(--fs-4)', fontWeight: 'var(--fw-semibold)', letterSpacing: '0.02em' }}>
                http://{status.host}:{status.port}/v1
              </div>
              <Pill tone={status.running ? 'live' : 'muted'}>{status.running ? 'running' : 'stopped'}</Pill>
            </div>
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-dim)', marginTop: '4px' }}>
              Point any OpenAI-compatible client or coding agent here to route requests locally.
            </div>
          </div>
          
          <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-1)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {status.running ? 'listening' : 'offline'}
          </span>
        </div>
      </Panel>

      <Panel title="Security & Authentication" style={{ marginTop: 'var(--space-3)' }}>
        <Field label="Gateway API key">
          {keyInfo?.present ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                flex: 1, background: 'var(--bg-input)', border: '1px solid var(--hairline)',
                borderRadius: 'var(--radius)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                <Key size={14} style={{ color: 'var(--accent)' }} />
                <span className="mono" style={{ flex: 1, fontSize: 'var(--fs-2)' }}>{keyInfo.masked}</span>
              </div>
              <Button onClick={handleCopyKey}>
                {copied ? <Check size={14} style={{ marginRight: '4px' }} /> : <Copy size={14} style={{ marginRight: '4px' }} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="danger" onClick={() => setConfirmRegen(true)}>
                <RefreshCw size={14} style={{ marginRight: '4px' }} />
                Regenerate
              </Button>
            </div>
          ) : (
            <span style={{ color: 'var(--red)', fontSize: 'var(--fs-1)' }}>
              The gateway key could not be read from the credential store.
            </span>
          )}
        </Field>
      </Panel>

      <Panel title="Gateway Network Settings" style={{ marginTop: 'var(--space-3)' }}>
        <form onSubmit={handleSave}>
          <div className="form-grid">
            <Field label="Host">
              <Input name="host" defaultValue={config.host} />
            </Field>
            <Field label="Port">
              <Input name="port" type="number" defaultValue={config.port} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
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
      </Panel>

      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate gateway key"
        message="Every client using the current key stops working until you give it the new one."
        confirmLabel="Regenerate key"
        onConfirm={handleRegenerate}
        onCancel={() => setConfirmRegen(false)}
      />
    </div>
  )
}
