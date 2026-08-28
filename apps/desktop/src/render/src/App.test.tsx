import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders and pings the preload bridge', async () => {
    render(<App />)
    const el = await screen.findByText('pong')
    expect(el).toBeTruthy()
  })
})
