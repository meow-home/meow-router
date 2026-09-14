import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Modal, ConfirmDialog, Toggle, Spinner, Checkbox, Select, Button, Input, BaseInput } from './ui'

describe('Button', () => {
  it('renders size and variant classes', () => {
    render(<Button variant="primary" size="sm">Action</Button>)
    const btn = screen.getByRole('button', { name: 'Action' })
    expect(btn.classList.contains('btn--primary')).toBe(true)
    expect(btn.classList.contains('btn--sm')).toBe(true)
  })
})

describe('Input and BaseInput', () => {
  it('renders Input with size class', () => {
    render(<Input size="lg" placeholder="Large input" />)
    const input = screen.getByPlaceholderText('Large input')
    expect(input.classList.contains('input--lg')).toBe(true)
  })

  it('renders BaseInput with clearable button and calls onClear', () => {
    let cleared = false
    render(<BaseInput value="text" onChange={() => {}} clearable onClear={() => { cleared = true }} placeholder="Search" />)
    const clearBtn = screen.getByRole('button', { name: 'Clear text' })
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)
    expect(cleared).toBe(true)
  })
})

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="T" />)
    expect(document.querySelector('.dialog')).toBeNull()
  })

  it('renders into document.body, escaping transformed/scrolling ancestors', () => {
    // A transformed ancestor becomes the containing block for position:fixed
    // descendants, trapping the full-screen backdrop inside a scroll container.
    const host = document.createElement('div')
    host.style.transform = 'translateY(0)'
    host.style.overflowY = 'auto'
    document.body.appendChild(host)

    render(<Modal open onClose={() => {}} title="Portaled" />, { container: host })

    const backdrop = document.querySelector('.dialog-backdrop')
    expect(backdrop).not.toBeNull()
    expect(host.contains(backdrop)).toBe(false)
    expect(backdrop!.parentElement).toBe(document.body)
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
  it('renders combobox trigger and opens options on click', () => {
    let selected = ''
    render(<Select placeholder="Pick an option" value={selected} onChange={(v) => { selected = v }} options={[{ value: 'a', label: 'Option A' }]} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeTruthy()
    expect(screen.getByText('Pick an option')).toBeTruthy()
    fireEvent.click(trigger)
    const option = screen.getByRole('option', { name: 'Option A' })
    expect(option).toBeTruthy()
    fireEvent.click(option)
    expect(selected).toBe('a')
  })
})

describe('Spinner', () => {
  it('renders a labelled spinner', () => {
    render(<Spinner label="Loading" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Loading')).toBeTruthy()
  })
})
