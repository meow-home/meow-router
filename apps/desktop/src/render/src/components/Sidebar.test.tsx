import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('shows the app version at the bottom of the sidebar', async () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} onCheckUpdate={vi.fn()} />)
    expect(await screen.findByText(/v\?|v0\.\d+\.\d+/)).toBeTruthy()
    expect(screen.getByText(/v0\.1\.0/)).toBeTruthy()
  })

  it('renders a Check update button in the footer', () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} onCheckUpdate={vi.fn()} />)
    expect(screen.getByText(/Check update/i)).toBeTruthy()
  })

  it('calls onCheckUpdate when Check update is clicked', () => {
    const onCheckUpdate = vi.fn()
    render(<Sidebar active="providers" onSelect={vi.fn()} onCheckUpdate={onCheckUpdate} />)
    fireEvent.click(screen.getByText(/Check update/i))
    expect(onCheckUpdate).toHaveBeenCalled()
  })

  it('shows Checking… when the checking prop is true', () => {
    render(<Sidebar active="providers" onSelect={vi.fn()} checking onCheckUpdate={vi.fn()} />)
    expect(screen.getByText(/Checking…/i)).toBeTruthy()
  })

  it('highlights the active nav item with aria-current', () => {
    render(<Sidebar active="models" onSelect={vi.fn()} onCheckUpdate={vi.fn()} />)
    const activeItem = screen.getByText('Models')
    expect(activeItem.closest('button')?.getAttribute('aria-current')).toBe('page')
  })
})
