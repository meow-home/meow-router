import type { PersistedConnection } from '../connection'
import type { GatewayConfigRow, NewGatewayConfig } from '../types'

type RawConfig = Omit<GatewayConfigRow, 'auth_enabled' | 'startup_enabled'> & {
  auth_enabled: number
  startup_enabled: number
}

function mapRow(r: RawConfig): GatewayConfigRow {
  return {
    ...r,
    auth_enabled: r.auth_enabled === 1,
    startup_enabled: r.startup_enabled === 1
  }
}

export class GatewayConfigRepository {
  constructor(private readonly db: PersistedConnection) {}

  get(): GatewayConfigRow {
    const r = this.db.prepare('SELECT * FROM gateway_config WHERE id = 1').get([]) as
      | RawConfig
      | undefined
    return r
      ? mapRow(r)
      : {
          id: 1,
          host: '127.0.0.1',
          port: 8317,
          auth_enabled: false,
          startup_enabled: false
        }
  }

  save(input: NewGatewayConfig): GatewayConfigRow {
    const row: GatewayConfigRow = { id: 1, ...input }
    this.db
      .prepare(
        `INSERT INTO gateway_config (id, host, port, auth_enabled, startup_enabled)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           host = excluded.host,
           port = excluded.port,
           auth_enabled = excluded.auth_enabled,
           startup_enabled = excluded.startup_enabled`
      )
      .run([row.id, row.host, row.port, row.auth_enabled ? 1 : 0, row.startup_enabled ? 1 : 0])
    this.db.save()
    return row
  }
}
