// Tests for RoutingPolicyRepository CRUD and config parsing (T701).
// Loop prevention: at most one candidate per provider; MAX_ROUTES enforced by the
// service, not the repo, but the repo dedupes providers for config arrays.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openDatabase, closeDatabase, type PersistedConnection } from '../connection'
import { RoutingPolicyRepository, RoutingPolicyError, parseRoutingConfig } from './index'

describe('parseRoutingConfig', () => {
  it('returns [] for null/empty config', () => {
    expect(parseRoutingConfig(null)).toEqual([])
    expect(parseRoutingConfig('')).toEqual([])
  })

  it('parses an ordered candidate list', () => {
    const c = parseRoutingConfig(
      JSON.stringify([
        { providerId: 'openai', providerModelId: 'gpt-4o' },
        { providerId: 'deepseek', providerModelId: 'deepseek-chat' }
      ])
    )
    expect(c).toEqual([
      { providerId: 'openai', providerModelId: 'gpt-4o' },
      { providerId: 'deepseek', providerModelId: 'deepseek-chat' }
    ])
  })

  it('dedupes providers (loop prevention)', () => {
    const c = parseRoutingConfig(
      JSON.stringify([
        { providerId: 'openai', providerModelId: 'gpt-4o' },
        { providerId: 'openai', providerModelId: 'gpt-4o-mini' }
      ])
    )
    expect(c).toHaveLength(1)
  })

  it('throws on malformed JSON', () => {
    expect(() => parseRoutingConfig('{oops')).toThrow(RoutingPolicyError)
  })

  it('throws on non-array config', () => {
    expect(() => parseRoutingConfig(JSON.stringify({ notAnArray: true }))).toThrow(RoutingPolicyError)
  })
})

describe('RoutingPolicyRepository', () => {
  let db: PersistedConnection
  let repo: RoutingPolicyRepository

  beforeEach(async () => {
    db = await openDatabase(':memory:')
    repo = new RoutingPolicyRepository(db)
  })

  afterEach(() => closeDatabase(db))

  it('creates and reads back a policy with default strategy', () => {
    const p = repo.create({
      name: 'fallback-a',
      config_json: JSON.stringify([{ providerId: 'openai', providerModelId: 'gpt-4o' }])
    })
    expect(p.id).toBeTruthy()
    expect(p.strategy).toBe('sequential')
    expect(repo.findById(p.id)?.name).toBe('fallback-a')
  })

  it('rejects an invalid name', () => {
    expect(() => repo.create({ name: 'has space', config_json: null })).toThrow(RoutingPolicyError)
  })

  it('rejects an unsupported strategy', () => {
    expect(() => repo.create({ name: 'x', strategy: 'random' as never, config_json: null })).toThrow(
      RoutingPolicyError
    )
  })

  it('lists policies ordered by name', () => {
    repo.create({ name: 'b', config_json: null })
    repo.create({ name: 'a', config_json: null })
    expect(repo.list().map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('update changes config and name', () => {
    const p = repo.create({ name: 'x', config_json: null })
    const updated = repo.update(p.id, { name: 'y', config_json: JSON.stringify([{ providerId: 'deepseek', providerModelId: 'ds' }]) })
    expect(updated?.name).toBe('y')
    expect(repo.candidates(p.id)).toEqual([{ providerId: 'deepseek', providerModelId: 'ds' }])
  })

  it('candidates() returns [] when no policy found', () => {
    expect(repo.candidates('missing')).toEqual([])
  })

  it('delete removes the policy', () => {
    const p = repo.create({ name: 'z', config_json: null })
    expect(repo.delete(p.id)).toBe(true)
    expect(repo.findById(p.id)).toBeUndefined()
  })
})
