import { randomUUID } from 'node:crypto'
import type { PersistedConnection } from '../connection'
import type { ModelRow, NewModel } from '../types'

type RawModel = Omit<ModelRow, 'enabled'> & { enabled: number }

function mapRow(r: RawModel): ModelRow {
  return { ...r, enabled: r.enabled === 1 }
}

export class ModelRepository {
  constructor(private readonly db: PersistedConnection) {}

  create(input: NewModel): ModelRow {
    const row: ModelRow = {
      id: input.id || randomUUID(),
      provider_id: input.provider_id,
      provider_model_id: input.provider_model_id,
      display_name: input.display_name,
      context_window: input.context_window ?? null,
      input_price: input.input_price ?? null,
      output_price: input.output_price ?? null,
      capabilities_json: input.capabilities_json ?? null,
      enabled: input.enabled ?? true,
      discovered_at: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO model (id, provider_id, provider_model_id, display_name, context_window,
                            input_price, output_price, capabilities_json, enabled, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run([
        row.id, row.provider_id, row.provider_model_id, row.display_name, row.context_window,
        row.input_price, row.output_price, row.capabilities_json, row.enabled ? 1 : 0, row.discovered_at
      ])
    this.db.save()
    return row
  }

  findById(id: string): ModelRow | undefined {
    const r = this.db.prepare('SELECT * FROM model WHERE id = ?').get([id]) as RawModel | undefined
    return r ? mapRow(r) : undefined
  }

  findByProviderModel(providerId: string, providerModelId: string): ModelRow | undefined {
    const r = this.db
      .prepare('SELECT * FROM model WHERE provider_id = ? AND provider_model_id = ?')
      .get([providerId, providerModelId]) as RawModel | undefined
    return r ? mapRow(r) : undefined
  }

  listByProvider(providerId: string): ModelRow[] {
    return (
      this.db
        .prepare('SELECT * FROM model WHERE provider_id = ? ORDER BY display_name')
        .all([providerId]) as RawModel[]
    ).map(mapRow)
  }

  list(): ModelRow[] {
    return (this.db.prepare('SELECT * FROM model ORDER BY provider_id, display_name').all() as RawModel[]).map(mapRow)
  }

  upsertByProviderModel(input: Omit<NewModel, 'id'>): ModelRow {
    const existing = this.db
      .prepare('SELECT * FROM model WHERE provider_id = ? AND provider_model_id = ?')
      .get([input.provider_id, input.provider_model_id]) as RawModel | undefined
    if (existing) {
      const prev = mapRow(existing)
      const merged: ModelRow = {
        ...prev,
        display_name: input.display_name,
        context_window: input.context_window ?? prev.context_window,
        input_price: input.input_price ?? prev.input_price,
        output_price: input.output_price ?? prev.output_price,
        capabilities_json: input.capabilities_json ?? prev.capabilities_json,
        enabled: input.enabled ?? prev.enabled,
        discovered_at: new Date().toISOString()
      }
      this.db
        .prepare(
          `UPDATE model
           SET display_name = ?, context_window = ?, input_price = ?, output_price = ?,
               capabilities_json = ?, enabled = ?, discovered_at = ?
           WHERE id = ?`
        )
        .run([
          merged.display_name, merged.context_window, merged.input_price, merged.output_price,
          merged.capabilities_json, merged.enabled ? 1 : 0, merged.discovered_at, merged.id
        ])
      this.db.save()
      return merged
    }
    return this.create(input)
  }

  update(id: string, patch: Partial<Omit<ModelRow, 'id' | 'created_at' | 'discovered_at'>>): ModelRow | undefined {
    const existing = this.findById(id)
    if (!existing) return undefined
    const merged: ModelRow = {
      ...existing,
      ...patch,
      enabled: patch.enabled ?? existing.enabled,
      discovered_at: existing.discovered_at
    }
    this.db
      .prepare(
        `UPDATE model
         SET provider_id = ?, provider_model_id = ?, display_name = ?,
             context_window = ?, input_price = ?, output_price = ?,
             capabilities_json = ?, enabled = ?, discovered_at = ?
         WHERE id = ?`
      )
      .run([
        merged.provider_id, merged.provider_model_id, merged.display_name,
        merged.context_window, merged.input_price, merged.output_price,
        merged.capabilities_json, merged.enabled ? 1 : 0, merged.discovered_at, merged.id
      ])
    this.db.save()
    return merged
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM model WHERE id = ?').run([id])
    this.db.save()
    return res.changes > 0
  }
}
