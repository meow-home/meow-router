import { describe, it, expect } from 'vitest'
import { compareSemver, selectAsset, type AssetMeta } from './version'

describe('compareSemver', () => {
  it('returns 1 when a > b (patch)', () => {
    expect(compareSemver('0.3.0', '0.2.0')).toBe(1)
  })
  it('returns -1 when a < b (minor)', () => {
    expect(compareSemver('0.2.0', '0.3.0')).toBe(-1)
  })
  it('handles two-digit segments (0.10.0 > 0.9.0)', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1)
  })
  it('returns 0 for equal versions', () => {
    expect(compareSemver('0.3.0', '0.3.0')).toBe(0)
  })
  it('ignores a leading v', () => {
    expect(compareSemver('v0.4.0', '0.3.0')).toBe(1)
  })
  it('ignores prerelease/build suffix', () => {
    expect(compareSemver('0.4.0-beta.1', '0.4.0-alpha.1')).toBe(0)
  })
})

describe('selectAsset', () => {
  const assets: AssetMeta[] = [
    { name: 'Meow_gateway_0.4.0_x64.exe', downloadUrl: 'u/w.exe', digest: 'sha256:aa' },
    { name: 'Meow_gateway_0.4.0_x64.dmg', downloadUrl: 'u/m.dmg', digest: 'sha256:bb' },
    { name: 'Meow_gateway_0.4.0_x86_64.AppImage', downloadUrl: 'u/l.AppImage', digest: 'sha256:cc' },
    { name: 'Meow_gateway_0.4.0_amd64.deb', downloadUrl: 'u/l.deb', digest: 'sha256:dd' }
  ]

  it('picks .exe on win32', () => {
    expect(selectAsset(assets, 'win32', 'x64')?.name).toBe('Meow_gateway_0.4.0_x64.exe')
  })
  it('picks .dmg on darwin', () => {
    expect(selectAsset(assets, 'darwin', 'x64')?.name).toBe('Meow_gateway_0.4.0_x64.dmg')
  })
  it('prefers .AppImage over .deb on linux', () => {
    expect(selectAsset(assets, 'linux', 'x64')?.name).toBe('Meow_gateway_0.4.0_x86_64.AppImage')
  })
  it('returns undefined when no asset matches', () => {
    expect(selectAsset(assets, 'freebsd', 'x64')).toBeUndefined()
  })
})
