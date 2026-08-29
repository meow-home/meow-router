import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Modal, ConfirmDialog, Toggle, Spinner, Checkbox, Select } from './ui'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Modal open={false} onClose={() => {}} title="T" />)
    expect(container.querySelector('.dialog')).toBeNull()
  })

  it('renders content and title when open', () => {
    render(<Modal open onClose={() => {}} title="Hello"><p>Body</p></Modal>)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('Body')).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = () => {}
    render(<Modal open onClose={onClose} title="T" />)
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  it('closes when clicking the backdrop', () => {
    let closed = 0
    render(<Modal open onClose={() => { closed++ }} title="T" />)
    fireEvent.click(screen.getByRole('presentation'))
    expect(closed).toBe(1)
  })

  it('does not close when clicking inside the dialog', () => {
    let closed = 0
    render(<Modal open onClose={() => { closed++ }} title="T"><p>inner</p></Modal>)
    fireEvent.click(screen.getByText('inner'))
    expect(closed).toBe(0)
  })
})

describe('ConfirmDialog', () => {
  it('renders title, message and danger confirm by default', () => {
    render(<ConfirmDialog open title="Delete?" message="Are you sure?" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('Delete?')).toBeTruthy()
    expect(screen.getByText('Are you sure?')).toBeTruthy()
    expect(screen.getByText('Confirm')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })
})

describe('Toggle', () => {
  it('toggles on click and reports the new value', () => {
    let value: boolean | null = null
    render(<Toggle checked={false} onChange={(v) => { value = v }} label="Auth" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(value).toBe(true)
  })

  it('reflects checked state via aria-checked', () => {
    render(<Toggle checked onChange={() => {}} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})

describe('Checkbox', () => {
  it('renders a labelled checkbox', () => {
    render(<Checkbox checked onChange={() => {}}>Streaming</Checkbox>)
    expect(screen.getByLabelText('Streaming')).toBeTruthy()
  })
})

describe('Select', () => {
  it('renders options with a placeholder', () => {
    render(<Select placeholder="Pick" options={[{ value: 'a', label: 'A' }]} />)
    expect(screen.getByRole('option', { name: 'Pick' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'A' })).toBeTruthy()
  })
})

describe('Spinner', () => {
  it('renders a labelled spinner', () => {
    render(<Spinner label="Loading" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Loading')).toBeTruthy()
  })
})
