// Thin adapter over sql.js (pure WebAssembly SQLite).
//
// Why not better-sqlite3: the native module segfaults on this dev environment
// (Node v20.19 + Windows) at `new Database()`, making the chosen better-sqlite3
// approach un-runnable here. sql.js is a pure-WASM build of SQLite that needs no
// native compilation and does not segfault. This adapter exposes a small,
// better-sqlite3-like synchronous API so the persistence layer stays decoupled
// from the underlying engine and can be swapped later.

import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import type { Queryable, QueryableStatement, StatementResult } from './sqltypes'

let SQL_PROMISE: Promise<SqlJsStatic> | null = null

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs()
  }
  return SQL_PROMISE
}

function normalizeParams(
  params: Record<string, unknown> | unknown[] | undefined
): unknown[] | Record<string, unknown> | undefined {
  return params
}

export class SqlDb implements Queryable {
  constructor(private readonly raw: SqlJsDatabase) {}

  static async open(existing?: Uint8Array): Promise<SqlDb> {
    const SQL = await loadSqlJs()
    const raw = existing && existing.length > 0 ? new SQL.Database(existing) : new SQL.Database()
    return new SqlDb(raw)
  }

  run(sql: string, params?: Record<string, unknown> | unknown[]): StatementResult {
    const stmt = this.raw.prepare(sql)
    try {
      if (params) stmt.bind(normalizeParams(params) as never)
      else stmt.run()
      return { changes: this.raw.getRowsModified(), lastInsertRowid: 0 }
    } finally {
      stmt.free()
    }
  }

  prepare(sql: string): QueryableStatement {
    const stmt = this.raw.prepare(sql)
    return {
      run: (params) => {
        stmt.bind((normalizeParams(params) ?? []) as never)
        stmt.step()
        return { changes: this.raw.getRowsModified(), lastInsertRowid: 0 }
      },
      get: (params) => {
        stmt.bind((normalizeParams(params) ?? []) as never)
        if (stmt.step()) return stmt.getAsObject() as Record<string, unknown>
        return undefined
      },
      all: (params) => {
        stmt.bind((normalizeParams(params) ?? []) as never)
        const rows: Record<string, unknown>[] = []
        while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>)
        return rows
      },
      free: () => stmt.free()
    }
  }

  exec(sql: string): unknown[] {
    return this.raw.exec(sql)
  }

  pragma(_sql: string): void {
    // Not supported by sql.js; persisted via export() on save/close.
  }

  exportBytes(): Uint8Array {
    return this.raw.export()
  }

  close(): void {
    try {
      this.raw.close()
    } catch {
      // ignore double-close
    }
  }
}
