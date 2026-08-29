// sql.js-backed database connection with on-disk persistence.
//
// sql.js keeps the database in memory and exposes `export()` to obtain the full
// DB as bytes. To persist across restarts we load existing bytes from disk on
// open and write them back on demand (`save()`) or on close. For an app storing
// small non-secret config data this is acceptable and safe (credentials live in
// the OS secure store, never here).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Queryable } from './sqltypes'
import { SqlDb } from './sqljs'
import { migrate } from './migrations'

export type AppDatabase = Queryable

export interface PersistedConnection extends AppDatabase {
  filePath: string
  save(): void
}

export async function openDatabase(filePath: string): Promise<PersistedConnection> {
  let existing: Uint8Array | undefined
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true })
    try {
      existing = readFileSync(filePath)
    } catch {
      existing = undefined
    }
  }

  const db = await SqlDb.open(existing)
  migrate(db)

  const conn = db as unknown as PersistedConnection
  conn.filePath = filePath
  conn.save = () => {
    if (filePath === ':memory:') return
    writeFileSync(filePath, Buffer.from(db.exportBytes()))
  }
  return conn
}

const CLOSED = Symbol('meow.gateway.db.closed')

export function closeDatabase(db: PersistedConnection | AppDatabase): void {
  const state = db as {
    [CLOSED]?: boolean
    save?: () => void
    close: () => void
  }
  if (state[CLOSED]) return
  state[CLOSED] = true
  // Flush pending bytes only if the handle is still open.
  if (typeof state.save === 'function') {
    try {
      state.save()
    } catch {
      // already closed — ignore
    }
  }
  db.close()
}
