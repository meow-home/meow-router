import { vi } from 'vitest'

Object.defineProperty(window, 'meowGateway', {
  value: {
    ping: vi.fn().mockResolvedValue({ pong: 'pong', echo: '' })
  },
  configurable: true
})
