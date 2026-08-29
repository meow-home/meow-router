// Repository for virtual models: stable local names mapped to provider models.
//
// A virtual model lets a client reference e.g. `meow-coding` which the gateway
// resolves to `deepseek / deepseek-chat`. Exposed over IPC and used by the
// gateway's model resolver.

import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { VirtualModelRow, NewVirtualModel } from '../types'

type RawVirtualModel = Omit<VirtualModelRow, 'enabled'> & { enabled: number }

function mapRow(r: RawVirtualModel): VirtualModelRow {
  return { ...r, enabled: r.enabled === 1 }
}

export interface VirtualModelValidationError {
  field: 'display_name' | 'provider_id' | 'provider_model_id'
  message: string
}

// A validation failure that can be surfaced to the renderer as a client error.
export class VirtualModelError extends Error {
  readonly errors: VirtualModelValidationError[]
  constructor(errors: VirtualModelValidationError[]) {
    super(errors.map((e) => e.message).join('; '))
    this.name = 'VirtualModelError'
    this.errors = errors
  }
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function validate(
  input: NewVirtualModel,
  deps: { providerExists(id: string): boolean; providerModelExists(providerId: string, modelId: string): boolean }
): VirtualModelValidationError[] {
  const errors: VirtualModelValidationError[] = []
  if (!input.display_name || !NAME_RE.test(input.display_name)) {
    errors.push({
      field: 'display_name',
      message: '`display_name` must be 1-64 chars starting with a letter/digit (letters, digits, `._-`).'
    })
  }
  if (!input.provider_id) {
    errors.push({ field: 'provider_id', message: '`provider_id` is required.' })
  } else if (!deps.providerExists(input.provider_id)) {
    errors.push({ field: 'provider_id', message: `Unknown provider: ${input.provider_id}` })
  }
  if (!input.provider_model_id) {
    errors.push({ field: 'provider_model_id', message: '`provider_model_id` is required.' })
  } else if (
    input.provider_id &&
    deps.providerExists(input.provider_id) &&
    !deps.providerModelExists(input.provider_id, input.provider_model_id)
  ) {
    errors.push({
      field: 'provider_model_id',
      message: `Provider ${input.provider_id} has no such model: ${input.provider_model_id}`
    })
  }
  if (errors.length > 0) throw new VirtualModelError(errors)
  return errors
}

export class VirtualModelRepository {
  constructor(private readonly db: PersistedConnection) {}

  private providerExists(id: string): boolean {
    return this.db.prepare('SELECT id FROM provider WHERE id = ?').get([id]) !== undefined
  }

  private providerModelExists(providerId: string, modelId: string): boolean {
    return (
      this.db
        .prepare('SELECT id FROM model WHERE provider_id = ? AND provider_model_id = ?')
        .get([providerId, modelId]) !== undefined
    )
  }

  create(input: NewVirtualModel): VirtualModelRow {
    validate(input, { providerExists: this.providerExists.bind(this), providerModelExists: this.providerModelExists.bind(this) })
    const now = new Date().toISOString()
    const row: VirtualModelRow = {
      id: input.id || randomUUID(),
      display_name: input.display_name.trim(),
      provider_id: input.provider_id,
      provider_model_id: input.provider_model_id,
      routing_policy_id: input.routing_policy_id ?? null,
      enabled: input.enabled ?? true,
      created_at: now,
      updated_at: now
    }
    this.db
      .prepare(
        `INSERT INTO virtual_model (id, display_name, provider_id, provider_model_id,
                                    routing_policy_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run([
        row.id, row.display_name, row.provider_id, row.provider_model_id,
        row.routing_policy_id, row.enabled ? 1 : 0, row.created_at, row.updated_at
      ])
    this.db.save()
    return row
  }

  findById(id: string): VirtualModelRow | undefined {
    const r = this.db.prepare('SELECT * FROM virtual_model WHERE id = ?').get([id]) as RawVirtualModel | undefined
    return r ? mapRow(r) : undefined
  }

  findByDisplayName(name: string): VirtualModelRow | undefined {
    const r = this.db.prepare('SELECT * FROM virtual_model WHERE display_name = ?').get([name]) as RawVirtualModel | undefined
    return r ? mapRow(r) : undefined
  }

  list(): VirtualModelRow[] {
    return (
      this.db.prepare('SELECT * FROM virtual_model ORDER BY display_name').all() as RawVirtualModel[]
    ).map(mapRow)
  }

  listEnabled(): VirtualModelRow[] {
    return (
      this.db
        .prepare('SELECT * FROM virtual_model WHERE enabled = 1 ORDER BY display_name')
        .all() as RawVirtualModel[]
    ).map(mapRow)
  }

  update(id: string, patch: Partial<Omit<VirtualModelRow, 'id' | 'created_at'>>): VirtualModelRow | undefined {
    const existing = this.findVirtualModel(id)
    if (!existing) return undefined
    const merged: VirtualModelRow = {
      ...existing,
      display_name: patch.display_name ?? existing.display_name,
      provider_id: patch.provider_id ?? existing.provider_id,
      provider_model_id: patch.provider_model_id ?? existing.provider_model_id,
      routing_policy_id: patch.routing_policy_id === undefined ? existing.routing_policy_id : patch.routing_policy_id,
      enabled: patch.enabled ?? existing.enabled,
      updated_at: new Date().toISOString()
    }
    validate(merged, { providerExists: this.providerExists.bind(this), providerModelExists: this.providerModelExists.bind(this) })
    this.db
      .prepare(
        `UPDATE virtual_model
         SET display_name = ?, provider_id = ?, provider_model_id = ?,
             routing_policy_id = ?, enabled = ?, updated_at = ?
         WHERE id = ?`
      )
      .run([
        merged.display_name, merged.provider_id, merged.provider_model_id,
        merged.routing_policy_id, merged.enabled ? 1 : 0, merged.updated_at, merged.id
      ])
    this.db.save()
    return merged
  }

  setEnabled(id: string, enabled: boolean): VirtualModelRow | undefined {
    const existing = this.findById(id)
    if (!existing) return undefined
    return this.update(id, { enabled })
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM virtual_model WHERE id = ?').run([id])
    this.db.save()
    return res.changes > 0
  }

  // Internal finder used by update() that returns the raw row (mapRow applied).
  private findVirtualModel(id: string): VirtualModelRow | undefined {
    const r = this.db.prepare('SELECT * FROM virtual_model WHERE id = ?').get([id]) as RawVirtualModel | undefined
    return r ? mapRow(r) : undefined
  }
}
