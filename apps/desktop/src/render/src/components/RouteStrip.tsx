/* SIGNATURE — the RouteStrip.
   A live view of the request path a coding agent's traffic takes:
   Agent ▬▶ Gateway ▬▶ Provider, with the packet (selected virtual model)
   riding the conduit. The gateway node pulses green while the server runs.
   It encodes the product's true topology: nothing is decoration. */

import type { ProviderWithCredential, VirtualModelRow } from '@shared/ipc'
import { Pill, classNames } from './ui'

const SPEED = 1.6 // packet traversal seconds — one full pass

function Node({
  label,
  sub,
  tone,
}: {
  label: string
  sub?: string
  tone: 'idle' | 'live' | 'signal'
}) {
  return (
    <div className={classNames('rs-node', `rs-node--${tone}`)}>
      <span className="rs-node__beacon" aria-hidden="true" />
      <span className="rs-node__label">{label}</span>
      {sub && <span className="rs-node__sub">{sub}</span>}
    </div>
  )
}

function Conduit({ active }: { active: 'idle' | 'live' | 'signal' }) {
  return (
    <div className="rs-link" aria-hidden="true">
      <span className="rs-track" />
      {active !== 'idle' && (
        <span className={`rs-packet rs-packet--${active}`} style={{ animationDuration: `${SPEED}s` }} />
      )}
    </div>
  )
}

export function RouteStrip({
  running,
  providers,
  activeProviderId,
  activeModel,
}: {
  running: boolean
  providers: ProviderWithCredential[]
  activeProviderId?: string
  activeModel?: VirtualModelRow | null
}) {
  const provider =
    providers.find((p) => p.id === activeProviderId) ??
    providers.find((p) => p.id === activeModel?.provider_id)

  const gatewayTone = running ? 'live' : 'idle'
  const packet = running ? 'live' : 'idle'

  return (
    <div className="rs">
      <Node label="Agent" sub="coding agent" tone="idle" />
      <Conduit active={packet} />
      <Node label="Gateway" sub={running ? 'serving' : 'idle'} tone={gatewayTone} />
      <Conduit active={packet} />
      <Node
        label={provider?.display_name ?? '—'}
        sub={activeModel?.display_name ?? 'no route'}
        tone={provider ? 'signal' : 'idle'}
      />
      <div className="rs__status">
        <Pill tone={running ? 'live' : 'muted'}>{running ? 'gateway up' : 'gateway down'}</Pill>
      </div>
    </div>
  )
}
