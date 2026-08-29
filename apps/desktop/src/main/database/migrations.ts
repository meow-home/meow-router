// Hand-written, idempotent, versioned migrations for the Meow Gateway database.
//
// Rules (see docs/DATA_MODEL.md):
// - Every schema change is a new versioned migration.
// - Migrations are idempotent (re-runnable) and never destructive.
// - Never delete user data during startup migration.
//
// Statements use `CREATE TABLE IF NOT EXISTS` so re-running a migration is safe.
// Applied versions are tracked in `schema_migrations`.

import type { Queryable } from './sqltypes'

export interface Migration {
  version: number
  name: string
  up: (db: Queryable) => void
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    INTEGER PRIMARY KEY,
          name       TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS provider (
          id           TEXT PRIMARY KEY,
          type         TEXT NOT NULL,
          display_name TEXT NOT NULL,
          enabled      INTEGER NOT NULL DEFAULT 1,
          base_url     TEXT,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account (
          id             TEXT PRIMARY KEY,
          provider_id    TEXT NOT NULL REFERENCES provider(id),
          display_name   TEXT NOT NULL,
          credential_ref TEXT NOT NULL,
          status         TEXT NOT NULL,
          created_at     TEXT NOT NULL,
          updated_at     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model (
          id                TEXT PRIMARY KEY,
          provider_id       TEXT NOT NULL REFERENCES provider(id),
          provider_model_id TEXT NOT NULL,
          display_name      TEXT NOT NULL,
          context_window    INTEGER,
          input_price       REAL,
          output_price      REAL,
          capabilities_json TEXT,
          enabled           INTEGER NOT NULL DEFAULT 1,
          discovered_at     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gateway_config (
          id              INTEGER PRIMARY KEY,
          host            TEXT NOT NULL,
          port            INTEGER NOT NULL,
          auth_enabled    INTEGER NOT NULL DEFAULT 0,
          startup_enabled INTEGER NOT NULL DEFAULT 0
        );
      `)
    }
  },
  {
    version: 2,
    name: 'virtual_models',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS virtual_model (
          id                 TEXT PRIMARY KEY,
          display_name       TEXT NOT NULL,
          provider_id        TEXT NOT NULL REFERENCES provider(id),
          provider_model_id  TEXT NOT NULL,
          routing_policy_id  TEXT,
          enabled            INTEGER NOT NULL DEFAULT 1,
          created_at         TEXT NOT NULL,
          updated_at         TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_model_name
          ON virtual_model (display_name);

        CREATE INDEX IF NOT EXISTS idx_virtual_model_provider
          ON virtual_model (provider_id);
      `)
    }
  },
  {
    version: 3,
    name: 'request_usage',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS request_usage (
          id                  TEXT PRIMARY KEY,
          request_id          TEXT NOT NULL,
          virtual_model_id    TEXT NOT NULL,
          provider_id         TEXT NOT NULL,
          provider_model_id   TEXT NOT NULL,
          input_tokens        INTEGER NOT NULL,
          output_tokens       INTEGER NOT NULL,
          cached_tokens       INTEGER NOT NULL DEFAULT 0,
          estimated_cost      REAL,
          latency_ms          INTEGER NOT NULL DEFAULT 0,
          status              TEXT NOT NULL,
          error_code          TEXT,
          created_at          TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_request_usage_provider
          ON request_usage (provider_id);

        CREATE INDEX IF NOT EXISTS idx_request_usage_created
          ON request_usage (created_at);
      `)
    }
  },
  {
    version: 4,
    name: 'routing_policy',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS routing_policy (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          strategy    TEXT NOT NULL,
          config_json TEXT,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_routing_policy_name
          ON routing_policy (name);

        -- Route attempt ordinal so each billing record is attributable.
        ALTER TABLE request_usage ADD COLUMN route_attempt INTEGER NOT NULL DEFAULT 0;
      `)
    }
  },
  {
    version: 5,
    name: 'model_stale',
    up: (db) => {
      db.exec(`
        ALTER TABLE model ADD COLUMN stale INTEGER NOT NULL DEFAULT 0;
      `)
    }
  }
]

export function migrate(db: Queryable): Migration[] {
  // Ensure the migration bookkeeping table exists before reading/writing it.
  // This bootstrap always runs and is not itself a versioned migration.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version
    )
  )

  const ran: Migration[] = []
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  )

  const sorted = [...MIGRATIONS].sort((a, b) => a.version - b.version)
  for (const m of sorted) {
    if (applied.has(m.version)) continue
    m.up(db)
    record.run([m.version, m.name, new Date().toISOString()])
    ran.push(m)
  }
  return ran
}
