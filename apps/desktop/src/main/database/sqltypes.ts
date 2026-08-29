// Minimal synchronous query interface used by the persistence layer.
// Keeps repositories decoupled from the concrete SQLite engine (sql.js today).

export interface StatementResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface QueryableStatement {
  run(params?: Record<string, unknown> | unknown[]): StatementResult
  get(params?: Record<string, unknown> | unknown[]): Record<string, unknown> | undefined
  all(params?: Record<string, unknown> | unknown[]): Record<string, unknown>[]
  free(): void
}

export interface Queryable {
  run(sql: string, params?: Record<string, unknown> | unknown[]): StatementResult
  prepare(sql: string): QueryableStatement
  exec(sql: string): unknown[]
  pragma(sql: string): void
  close(): void
}
