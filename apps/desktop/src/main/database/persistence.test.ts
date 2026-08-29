import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase, type PersistedConnection } from './connection'
import { ProviderRepository } from './repositories'

describe('file-backed database persistence', () => {
  let dir: string
  let dbPath: string
  let db: PersistedConnection

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'meow-gateway-'))
    dbPath = join(dir, 'meow.db')
    db = await openDatabase(dbPath)
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the database file in the given directory after a write', () => {
    new ProviderRepository(db).create({ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true })
    expect(existsSync(dbPath)).toBe(true)
    expect(readFileSync(dbPath).length).toBeGreaterThan(0)
  })

  it('persists written data across reopen (migrations are idempotent)', async () => {
    const providers = new ProviderRepository(db)
    providers.create({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true })
    closeDatabase(db)

    const db2 = await openDatabase(dbPath)
    try {
      const providers2 = new ProviderRepository(db2)
      expect(providers2.findById('p1')).toBeDefined()

      // Re-open did not duplicate any migration (idempotent).
      const rows = db2.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
      expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    } finally {
      closeDatabase(db2)
    }
  })

  it('store no secrets in the on-disk database', async () => {
    const providers = new ProviderRepository(db)
    providers.create({ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true })
    closeDatabase(db)

    const raw = readFileSync(dbPath, 'utf8')
    // A sample of what an API key might look like should never appear.
    expect(raw).not.toContain('sk-')
    expect(raw).not.toContain('api_key')
  })
})
