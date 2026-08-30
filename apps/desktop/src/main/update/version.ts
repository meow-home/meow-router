export interface AssetMeta {
  name: string
  downloadUrl: string
  digest?: string
}

export function compareSemver(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1
  return 0
}

function parse(v: string): { major: number; minor: number; patch: number } {
  const s = v.trim().replace(/^v/i, '').split(/[-+]/)[0]
  const [major = '0', minor = '0', patch = '0'] = s.split('.')
  return {
    major: Number(major) || 0,
    minor: Number(minor) || 0,
    patch: Number(patch) || 0
  }
}

const EXT_PREFERENCE: Record<string, string[]> = {
  win32: ['.exe'],
  darwin: ['.dmg'],
  linux: ['.AppImage', '.deb']
}

export function selectAsset(assets: AssetMeta[], platform: string, _arch: string): AssetMeta | undefined {
  const prefs = EXT_PREFERENCE[platform]
  if (!prefs) return undefined
  for (const ext of prefs) {
    const found = assets.find((a) => a.name.toLowerCase().endsWith(ext.toLowerCase()))
    if (found) return found
  }
  return undefined
}
