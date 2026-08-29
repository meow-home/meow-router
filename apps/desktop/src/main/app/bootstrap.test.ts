import { describe, it, expect } from 'vitest'
import { isValidModelInput, isValidModelPatch } from './bootstrap'

function omit<T extends Record<string, unknown>>(source: T, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...source }
  delete copy[key]
  return copy
}

describe('isValidModelInput', () => {
  const valid: Record<string, unknown> = {
    provider_id: 'p1',
    provider_model_id: 'openai/gpt-4o',
    display_name: 'GPT-4o',
    context_window: 128000,
    input_price: 0.0000025,
    output_price: 0.00001,
    capabilities_json: '{"supports_tools":true}',
    enabled: true
  }

  it('accepts a fully valid model input', () => {
    expect(isValidModelInput(valid)).toBe(true)
  })

  it('accepts a minimal valid model input (only required fields)', () => {
    expect(
      isValidModelInput({
        provider_id: 'p1',
        provider_model_id: 'deepseek/deepseek-chat',
        display_name: 'DeepSeek Chat'
      })
    ).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(isValidModelInput(null)).toBe(false)
    expect(isValidModelInput('nope')).toBe(false)
    expect(isValidModelInput(123)).toBe(false)
    expect(isValidModelInput([])).toBe(false)
  })

  it('rejects a missing provider_id', () => {
    expect(isValidModelInput(omit(valid, 'provider_id'))).toBe(false)
  })

  it('rejects a missing provider_model_id', () => {
    expect(isValidModelInput(omit(valid, 'provider_model_id'))).toBe(false)
  })

  it('rejects a missing display_name', () => {
    expect(isValidModelInput(omit(valid, 'display_name'))).toBe(false)
  })

  it('rejects an empty display_name', () => {
    expect(isValidModelInput({ ...valid, display_name: '' })).toBe(false)
  })

  it('rejects a non-integer context_window', () => {
    expect(isValidModelInput({ ...valid, context_window: 128000.5 })).toBe(false)
  })

  it('rejects a negative context_window', () => {
    expect(isValidModelInput({ ...valid, context_window: -1 })).toBe(false)
  })

  it('rejects a negative input_price', () => {
    expect(isValidModelInput({ ...valid, input_price: -0.01 })).toBe(false)
  })

  it('rejects a negative output_price', () => {
    expect(isValidModelInput({ ...valid, output_price: -0.01 })).toBe(false)
  })

  it('rejects capabilities_json longer than 4096 chars', () => {
    expect(isValidModelInput({ ...valid, capabilities_json: 'x'.repeat(4097) })).toBe(false)
  })

  it('accepts capabilities_json exactly at the 4096 char limit', () => {
    expect(isValidModelInput({ ...valid, capabilities_json: 'x'.repeat(4096) })).toBe(true)
  })

  it('rejects a non-boolean enabled', () => {
    expect(isValidModelInput({ ...valid, enabled: 'true' })).toBe(false)
    expect(isValidModelInput({ ...valid, enabled: 1 })).toBe(false)
  })

  it('rejects a non-string capabilities_json', () => {
    expect(isValidModelInput({ ...valid, capabilities_json: { foo: 'bar' } })).toBe(false)
  })
})

describe('isValidModelPatch', () => {
  const base: Record<string, unknown> = {
    display_name: 'GPT-4o',
    context_window: 128000,
    input_price: 0.0000025,
    output_price: 0.00001,
    capabilities_json: '{"supports_tools":true}',
    enabled: true
  }

  it('accepts a valid partial patch (no required provider fields)', () => {
    expect(isValidModelPatch({ display_name: 'GPT-4o Mini' })).toBe(true)
    expect(isValidModelPatch({ enabled: false })).toBe(true)
    expect(isValidModelPatch(base)).toBe(true)
  })

  it('accepts an empty patch (all fields optional)', () => {
    expect(isValidModelPatch({})).toBe(true)
  })

  it('rejects a non-object input', () => {
    expect(isValidModelPatch(null)).toBe(false)
    expect(isValidModelPatch('nope')).toBe(false)
    expect(isValidModelPatch([])).toBe(false)
  })

  it('rejects provider_id in a patch (immutable)', () => {
    expect(isValidModelPatch({ ...base, provider_id: 'p2' })).toBe(false)
  })

  it('rejects a negative context_window', () => {
    expect(isValidModelPatch({ context_window: -1 })).toBe(false)
    expect(isValidModelPatch({ context_window: 128000.5 })).toBe(false)
  })

  it('rejects a negative input_price', () => {
    expect(isValidModelPatch({ input_price: -0.01 })).toBe(false)
  })

  it('rejects a negative output_price', () => {
    expect(isValidModelPatch({ output_price: -0.01 })).toBe(false)
  })

  it('rejects an empty display_name', () => {
    expect(isValidModelPatch({ display_name: '' })).toBe(false)
  })

  it('rejects a non-string capabilities_json', () => {
    expect(isValidModelPatch({ capabilities_json: { foo: 'bar' } })).toBe(false)
    expect(isValidModelPatch({ capabilities_json: 'x'.repeat(4097) })).toBe(false)
  })

  it('rejects a non-boolean enabled', () => {
    expect(isValidModelPatch({ enabled: 'true' })).toBe(false)
    expect(isValidModelPatch({ enabled: 1 })).toBe(false)
  })
})
