import type { OAuthTokenBundle } from './types'

export interface OAuthTokenStore {
  get(ref: string): Promise<OAuthTokenBundle | null>
  set(ref: string, bundle: OAuthTokenBundle): Promise<void>
  delete(ref: string): Promise<void>
}
