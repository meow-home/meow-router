// Repository for routing policies.
//
// A routing policy defines the ordered candidates for a virtual model. The MVP
// strategy is `sequential` fallback: try candidate 0, on retryable failure try
// candidate 1, and so on. Config is JSON so pricing/weights stay data.

import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { RoutingPolicyRow, NewRoutingPolicy, RoutingCandidate, SequentialRoutingConfig } from '../types'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

// Raw on-disk row (strategy is a plain string before narrowing).
type RawRoutingPolicy = Omit<RoutingPolicyRow, 'strategy'> & { strategy: string }

function mapRow(r: RawRoutingPolicy): RoutingPolicyRow {
  const strategy = r.strategy === 'priority' ? 'priority' : 'sequential'
  return { ...r, strategy }
}

export class RoutingPolicyError extends Error {
  readonly field: 'name' | 'strategy' | 'config_json'
  readonly message: string
  constructor(field: 'name' | 'strategy' | 'config_json', message: string) {
    super(message)
    this.name = 'RoutingPolicyError'
    this.field = field
    this.message = message
  }
}

// Parses config_json into an ordered candidate list. Enforces loop prevention:
// no duplicate provider appears more than once, and at most MAX_CANDIDATES.
// Returns [] when config is absent/empty.
export function parseRoutingConfig(configJson: string | null): RoutingCandidate[] {
  if (!configJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(configJson)
  } catch {
    throw new RoutingPolicyError('config_json', 'Malformed config JSON.')
  }
  if (!Array.isArray(parsed)) {
    throw new RoutingPolicyError('config_json', 'Config must be a JSON array of candidates.')
  }
  const seen = new Set<string>()
  const candidates: RoutingCandidate[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const { providerId, providerModelId, weight } = item as Partial<RoutingCandidate>
    if (typeof providerId !== 'string' || typeof providerModelId !== 'string') continue
    if (seen.has(providerId)) continue // loop prevention: at most one candidate per provider
    seen.add(providerId)
    candidates.push({ providerId, providerModelId, ...(typeof weight === 'number' ? { weight } : {}) })
  }
  return candidates
}

export class RoutingPolicyRepository {
  constructor(private readonly db: PersistedConnection) {}

  create(input: NewRoutingPolicy): RoutingPolicyRow {
    if (!input.name || !NAME_RE.test(input.name)) {
      throw new RoutingPolicyError('name', '`name` must be 1-64 chars starting with a letter/digit (letters, digits, `._-`).')
    }
    const strategy = input.strategy ?? 'sequential'
    if (strategy !== 'sequential' && strategy !== 'priority') {
      throw new RoutingPolicyError('strategy', 'Unsupported routing strategy.')
    }
    // Validate config parses before writing.
    parseRoutingConfig(input.config_json ?? null)
    const now = new Date().toISOString()
    const row: RoutingPolicyRow = {
      id: input.id || randomUUID(),
      name: input.name.trim(),
      strategy,
      config_json: input.config_json ?? null,
      created_at: now,
      updated_at: now
    }
    this.db
      .prepare(
        `INSERT INTO routing_policy (id, name, strategy, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run([row.id, row.name, row.strategy, row.config_json, row.created_at, row.updated_at])
    this.db.save()
    return row
  }

  findById(id: string): RoutingPolicyRow | undefined {
    const r = this.db.prepare('SELECT * FROM routing_policy WHERE id = ?').get([id]) as RawRoutingPolicy | undefined
    return r ? mapRow(r) : undefined
  }

  list(): RoutingPolicyRow[] {
    return (this.db.prepare('SELECT * FROM routing_policy ORDER BY name').all() as RawRoutingPolicy[]).map(mapRow)
  }

  update(id: string, patch: Partial<Omit<RoutingPolicyRow, 'id' | 'created_at'>>): RoutingPolicyRow | undefined {
    const existing = this.findById(id)
    if (!existing) return undefined
    const merged: RoutingPolicyRow = {
      ...existing,
      name: patch.name ?? existing.name,
      strategy: patch.strategy ?? existing.strategy,
      config_json: patch.config_json === undefined ? existing.config_json : patch.config_json,
      updated_at: new Date().toISOString()
    }
    parseRoutingConfig(merged.config_json)
    this.db
      .prepare(
        `UPDATE routing_policy SET name = ?, strategy = ?, config_json = ?, updated_at = ? WHERE id = ?`
      )
      .run([merged.name, merged.strategy, merged.config_json, merged.updated_at, merged.id])
    this.db.save()
    return merged
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM routing_policy WHERE id = ?').run([id])
    this.db.save()
    return res.changes > 0
  }

  candidates(id: string): RoutingCandidate[] {
    const row = this.findById(id)
    if (!row) return []
    return parseRoutingConfig(row.config_json)
  }
}

export type { SequentialRoutingConfig }
