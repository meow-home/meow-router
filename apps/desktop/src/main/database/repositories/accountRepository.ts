import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { AccountRow, NewAccount } from '../types'

export class AccountRepository {
  constructor(private readonly db: PersistedConnection) {}

  create(input: NewAccount): AccountRow {
    const now = new Date().toISOString()
    const row: AccountRow = {
      id: input.id || randomUUID(),
      provider_id: input.provider_id,
      display_name: input.display_name,
      credential_ref: input.credential_ref,
      status: input.status ?? 'active',
      created_at: now,
      updated_at: now
    }
    this.db
      .prepare(
        `INSERT INTO account (id, provider_id, display_name, credential_ref, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run([row.id, row.provider_id, row.display_name, row.credential_ref, row.status, row.created_at, row.updated_at])
    this.db.save()
    return row
  }

  findById(id: string): AccountRow | undefined {
    return this.db.prepare('SELECT * FROM account WHERE id = ?').get([id]) as unknown as
      | AccountRow
      | undefined
  }

  listByProvider(providerId: string): AccountRow[] {
    return this.db
      .prepare('SELECT * FROM account WHERE provider_id = ? ORDER BY created_at')
      .all([providerId]) as unknown as AccountRow[]
  }

  update(id: string, patch: Partial<Omit<AccountRow, 'id' | 'created_at'>>): AccountRow | undefined {
    const existing = this.findById(id)
    if (!existing) return undefined
    const merged: AccountRow = {
      ...existing,
      ...patch,
      credential_ref: patch.credential_ref ?? existing.credential_ref,
      updated_at: new Date().toISOString()
    }
    this.db
      .prepare(
        `UPDATE account
         SET display_name = ?, credential_ref = ?,
             status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run([merged.display_name, merged.credential_ref, merged.status, merged.updated_at, merged.id])
    this.db.save()
    return merged
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM account WHERE id = ?').run([id])
    this.db.save()
    return res.changes > 0
  }
}
