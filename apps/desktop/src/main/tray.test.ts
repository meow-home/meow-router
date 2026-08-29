import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The tray module imports from 'electron', which is not available in the jsdom
// test environment. Mock the small surface it touches.
type MenuItem = { label?: string; type?: string; click?: () => void }
const createFromPath = vi.fn((_path: string) => ({ isEmpty: () => false }))
const setToolTip = vi.fn()
const setContextMenu = vi.fn()
const buildFromTemplate = vi.fn((template: MenuItem[]) => ({ template }))
const on = vi.fn()
const destroy = vi.fn()

vi.mock('electron', () => ({
  nativeImage: { createFromPath: (path: string) => createFromPath(path) },
  Tray: class {
    setToolTip = setToolTip
    setContextMenu = setContextMenu
    on = on
    destroy = destroy
  },
  Menu: { buildFromTemplate: (template: MenuItem[]) => buildFromTemplate(template) },
}))

// Import after vi.mock so the mocked modules are used.
import { createTray, destroyTray, hasTray } from './tray'

describe('tray', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    destroyTray()
  })

  afterEach(() => {
    destroyTray()
  })

  it('creates a tray with a tooltip and context menu', () => {
    const result = createTray({
      showWindow: () => {},
      hideWindow: () => {},
      quit: () => {},
    })

    expect(result).toBeTruthy()
    expect(hasTray()).toBe(true)
    expect(createFromPath).toHaveBeenCalled()
    expect(setToolTip).toHaveBeenCalledWith('Meow Gateway')
    expect(buildFromTemplate).toHaveBeenCalled()
    expect(setContextMenu).toHaveBeenCalled()
  })

  it('wires the menu items to the callbacks', () => {
    const cb = { showWindow: vi.fn(), hideWindow: vi.fn(), quit: vi.fn() }
    createTray(cb)

    const template = buildFromTemplate.mock.calls[0][0] as MenuItem[]
    expect(Array.isArray(template)).toBe(true)
    expect(template.some((i) => i.label === 'Show Meow Gateway')).toBe(true)
    expect(template.some((i) => i.label === 'Hide to Tray')).toBe(true)
    expect(template.some((i) => i.label === 'Quit')).toBe(true)
    expect(template.some((i) => i.type === 'separator')).toBe(true)

    const show = template.find((i) => i.label === 'Show Meow Gateway')!
    const quit = template.find((i) => i.label === 'Quit')!
    show.click?.()
    quit.click?.()
    expect(cb.showWindow).toHaveBeenCalled()
    expect(cb.quit).toHaveBeenCalled()
  })

  it('does not create a second tray when one already exists', () => {
    const first = createTray({ showWindow: () => {}, hideWindow: () => {}, quit: () => {} })
    const second = createTray({ showWindow: () => {}, hideWindow: () => {}, quit: () => {} })
    expect(first).toBeTruthy()
    expect(second).toBe(first)
    expect(buildFromTemplate).toHaveBeenCalledTimes(1)
  })

  it('destroyTray clears the tray and hasTray reports false', () => {
    createTray({ showWindow: () => {}, hideWindow: () => {}, quit: () => {} })
    expect(hasTray()).toBe(true)
    destroyTray()
    expect(hasTray()).toBe(false)
    expect(destroy).toHaveBeenCalled()
  })
})
