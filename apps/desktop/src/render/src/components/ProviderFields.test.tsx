import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProviderFields } from './ProviderFields'

const types = [{ id: 'openai', displayName: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', authType: 'bearer' }]

function renderFields(props: Partial<Parameters<typeof ProviderFields>[0]> = {}) {
  return render(
    <ProviderFields
      types={types}
      type="openai"
      setType={vi.fn()}
      displayName=""
      setDisplayName={vi.fn()}
      baseUrl=""
      setBaseUrl={vi.fn()}
      keyValue=""
      setKeyValue={vi.fn()}
      enabled
      setEnabled={vi.fn()}
      {...props}
    />
  )
}

describe('ProviderFields', () => {
  it('renders type select with options', () => {
    renderFields()
    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeTruthy()
  })

  it('disables type select when typeLocked', () => {
    const { container } = renderFields({ typeLocked: true })
    expect(container.querySelector('select')?.disabled).toBe(true)
  })

  it('hides enabled checkbox by default (add mode)', () => {
    const { container } = renderFields()
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
  })

  it('shows enabled checkbox when showEnabled (edit mode)', () => {
    const { container } = renderFields({ showEnabled: true })
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy()
  })
})
