import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the providers view by default', async () => {
    render(<App />)
    expect(await screen.findAllByText('Providers')).toBeTruthy()
    expect(screen.getByText('Add Provider')).toBeTruthy()
  })

  it('navigates to the gateway view', async () => {
    render(<App />)
    const btn = await screen.findByRole('button', { name: /Gateway/i })
    btn.click()
    expect(await screen.findByText(/Require gateway API key/i)).toBeTruthy()
    expect(screen.queryByText('Add Provider')).toBeNull()
  })
})
