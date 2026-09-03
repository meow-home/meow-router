import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The single-instance module imports from 'electron', which is not available in
// the jsdom test environment. Mock the small surface it touches, mirroring the
// approach used by tray.test.ts.
const requestSingleInstanceLock = vi.fn()
const quit = vi.fn()
const on = vi.fn()

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: (...args: unknown[]) => requestSingleInstanceLock(...args),
    quit: (...args: unknown[]) => quit(...args),
    on: (...args: unknown[]) => on(...args)
  }
}))

// Import after vi.mock so the mocked module is used.
import { acquireSingleInstanceLock } from './singleInstance'

describe('single instance lock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns true and registers a second-instance handler when the lock is acquired', () => {
    requestSingleInstanceLock.mockReturnValue(true)

    const result = acquireSingleInstanceLock({ onSecondInstance: () => {} })

    expect(result).toBe(true)
    expect(requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()
    expect(on).toHaveBeenCalledWith('second-instance', expect.any(Function))
  })

  it('returns false and quits the app when another instance holds the lock', () => {
    requestSingleInstanceLock.mockReturnValue(false)

    const result = acquireSingleInstanceLock({ onSecondInstance: () => {} })

    expect(result).toBe(false)
    expect(requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    // A process that fails to acquire the lock must NOT register a second-instance
    // handler; it is about to quit.
    expect(on).not.toHaveBeenCalled()
  })

  it('invokes onSecondInstance when the primary instance receives a second-instance event', () => {
    requestSingleInstanceLock.mockReturnValue(true)
    const onSecondInstance = vi.fn()

    acquireSingleInstanceLock({ onSecondInstance })

    // Grab the handler registered on 'second-instance' and invoke it.
    const handler = on.mock.calls.find((call) => call[0] === 'second-instance')?.[1] as () => void
    expect(handler).toBeTypeOf('function')
    handler()
    expect(onSecondInstance).toHaveBeenCalledTimes(1)
  })
})
