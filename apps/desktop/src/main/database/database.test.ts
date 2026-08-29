import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from './connection'
import { migrate } from './migrations'
import {
  ProviderRepository,
  AccountRepository,
  ModelRepository,
  GatewayConfigRepository
} from './repositories'

describe('database connection & migrations', () => {
  let db: PersistedConnection

  beforeEach(async () => {
    db = await openDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('creates all tables and a schema_migrations record', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('schema_migrations')
    expect(names).toContain('provider')
    expect(names).toContain('account')
    expect(names).toContain('model')
    expect(names).toContain('gateway_config')
    expect(names).toContain('virtual_model')
    expect(names).toContain('request_usage')
    expect(names).toContain('routing_policy')
  })

  it('records migrations exactly once', () => {
    const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
    expect(rows.length).toBe(7)
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('applies migrations in ascending version order', () => {
    const rows = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as { version: number }[]
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('ProviderRepository', () => {
  let db: PersistedConnection
  let repo: ProviderRepository
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new ProviderRepository(db)
  })
  afterEach(() => closeDatabase(db))

  it('creates and reads back a provider', () => {
    const created = repo.create({
      id: 'p1',
      type: 'deepseek',
      display_name: 'DeepSeek',
      enabled: true,
      base_url: 'https://api.deepseek.com'
    })
    expect(repo.findById('p1')).toEqual(created)
  })

  it('lists providers', () => {
    repo.create({ type: 'openai', display_name: 'A', enabled: true })
    repo.create({ type: 'deepseek', display_name: 'B', enabled: true })
    expect(repo.list()).toHaveLength(2)
  })

  it('updates a provider partially and bumps updated_at', () => {
    repo.create({ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true })
    const before = repo.findById('p1')!
    repo.update('p1', { enabled: false })
    const after = repo.findById('p1')!
    expect(after.enabled).toBe(false)
    expect(after.display_name).toBe('OpenAI')
    expect(after.updated_at >= before.updated_at).toBe(true)
  })

  it('deletes a provider', () => {
    repo.create({ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true })
    expect(repo.delete('p1')).toBe(true)
    expect(repo.findById('p1')).toBeUndefined()
  })

  it('does not persist credentials (no secret column present)', () => {
    const cols = db.prepare('PRAGMA table_info(provider)').all() as { name: string }[]
    expect(cols.some((c) => /secret|credential|api_?key/i.test(c.name))).toBe(false)
  })
})

describe('AccountRepository', () => {
  let db: PersistedConnection
  let providers: ProviderRepository
  let accounts: AccountRepository
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    providers = new ProviderRepository(db)
    accounts = new AccountRepository(db)
  })
  afterEach(() => closeDatabase(db))

  it('creates an account referencing a credential_ref (never a secret)', () => {
    providers.create({ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true })
    const acc = accounts.create({
      id: 'a1',
      provider_id: 'p1',
      display_name: 'Primary',
      credential_ref: 'secure-ref-123',
      status: 'active'
    })
    expect(acc.credential_ref).toBe('secure-ref-123')
    expect(Object.keys(acc)).not.toContain('secret')
    expect(Object.keys(acc)).not.toContain('api_key')
  })

  it('lists accounts by provider', () => {
    providers.create({ id: 'p1', type: 'openai', display_name: 'OpenAI', enabled: true })
    accounts.create({ provider_id: 'p1', display_name: 'A', credential_ref: 'r1', status: 'active' })
    accounts.create({ provider_id: 'p1', display_name: 'B', credential_ref: 'r2', status: 'active' })
    expect(accounts.listByProvider('p1')).toHaveLength(2)
  })
})

describe('ModelRepository', () => {
  let db: PersistedConnection
  let providers: ProviderRepository
  let models: ModelRepository
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    providers = new ProviderRepository(db)
    models = new ModelRepository(db)
  })
  afterEach(() => closeDatabase(db))

  it('creates and lists models for a provider', () => {
    providers.create({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true })
    models.create({
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat',
      context_window: 64000,
      input_price: 0.14,
      output_price: 0.28
    })
    const list = models.listByProvider('p1')
    expect(list).toHaveLength(1)
    expect(list[0].provider_model_id).toBe('deepseek-chat')
  })

  it('upserts by (provider_id, provider_model_id) without duplicating', () => {
    providers.create({ id: 'p1', type: 'deepseek', display_name: 'DeepSeek', enabled: true })
    models.upsertByProviderModel({
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat',
      context_window: 64000
    })
    models.upsertByProviderModel({
      provider_id: 'p1',
      provider_model_id: 'deepseek-chat',
      display_name: 'DeepSeek Chat (updated)',
      context_window: 128000
    })
    expect(models.listByProvider('p1')).toHaveLength(1)
    expect(models.listByProvider('p1')[0].context_window).toBe(128000)
  })
})

describe('GatewayConfigRepository', () => {
  let db: PersistedConnection
  let repo: GatewayConfigRepository
  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new GatewayConfigRepository(db)
  })
  afterEach(() => closeDatabase(db))

  it('returns defaults when unset', () => {
    const cfg = repo.get()
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(8317)
    expect(cfg.auth_enabled).toBe(true)
  })

  it('turns auth on for a config row written before the migration', () => {
    // Simulate a pre-migration row, then re-run migrations over it.
    db.exec(`
      INSERT INTO gateway_config (id, host, port, auth_enabled, startup_enabled)
      VALUES (1, '127.0.0.1', 8317, 0, 0)
      ON CONFLICT(id) DO UPDATE SET auth_enabled = 0;
      DELETE FROM schema_migrations WHERE version = 6;
    `)
    migrate(db)
    expect(repo.get().auth_enabled).toBe(true)
  })

  it('saves and reads back the single config row', () => {
    repo.save({ host: '127.0.0.1', port: 9000, auth_enabled: true, startup_enabled: true })
    const cfg = repo.get()
    expect(cfg.port).toBe(9000)
    expect(cfg.auth_enabled).toBe(true)
    expect(cfg.startup_enabled).toBe(true)
  })
})
