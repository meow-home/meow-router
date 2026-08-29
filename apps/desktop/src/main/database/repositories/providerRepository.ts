import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { ProviderRow, NewProvider } from '../types'

type RawProvider = Omit<ProviderRow, 'enabled'> & { enabled: number }

function mapRow(r: RawProvider): ProviderRow {
  return { ...r, enabled: r.enabled === 1 }
}

export class ProviderRepository {
  constructor(private readonly db: PersistedConnection) {}

  create(input: NewProvider): ProviderRow {
    const now = new Date().toISOString()
    const row: ProviderRow = {
      id: input.id || randomUUID(),
      type: input.type,
      display_name: input.display_name,
      enabled: input.enabled ?? true,
      base_url: input.base_url ?? null,
      created_at: now,
      updated_at: now
    }
    this.db
      .prepare(
        `INSERT INTO provider (id, type, display_name, enabled, base_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run([row.id, row.type, row.display_name, row.enabled ? 1 : 0, row.base_url, row.created_at, row.updated_at])
    this.db.save()
    return row
  }

  findById(id: string): ProviderRow | undefined {
    const r = this.db.prepare('SELECT * FROM provider WHERE id = ?').get([id]) as RawProvider | undefined
    return r ? mapRow(r) : undefined
  }

  list(): ProviderRow[] {
    return (this.db.prepare('SELECT * FROM provider ORDER BY created_at').all() as RawProvider[]).map(mapRow)
  }

  update(id: string, patch: Partial<Omit<ProviderRow, 'id' | 'created_at'>>): ProviderRow | undefined {
    const existing = this.findById(id)
    if (!existing) return undefined
    const merged: ProviderRow = {
      ...existing,
      ...patch,
      enabled: patch.enabled ?? existing.enabled,
      base_url: patch.base_url === undefined ? existing.base_url : patch.base_url,
      updated_at: new Date().toISOString()
    }
    this.db
      .prepare(
        `UPDATE provider
         SET type = ?, display_name = ?, enabled = ?,
             base_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .run([merged.type, merged.display_name, merged.enabled ? 1 : 0, merged.base_url, merged.updated_at, merged.id])
    this.db.save()
    return merged
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM provider WHERE id = ?').run([id])
    this.db.save()
    return res.changes > 0
  }
}
