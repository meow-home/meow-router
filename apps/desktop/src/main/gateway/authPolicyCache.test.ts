import { describe, it, expect, vi } from 'vitest'
import { createAuthPolicyCache } from './authPolicyCache'

describe('createAuthPolicyCache', () => {
  it('resolves the policy from its dependencies', async () => {
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey: async () => 'mgw_k' })
    expect(await cache.get()).toEqual({ enabled: true, key: 'mgw_k' })
  })

  it('reads the key only once across repeated gets', async () => {
    const readKey = vi.fn().mockResolvedValue('mgw_k')
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey })
    await cache.get()
    await cache.get()
    await cache.get()
    expect(readKey).toHaveBeenCalledTimes(1)
  })

  it('re-reads after invalidate', async () => {
    const readKey = vi.fn().mockResolvedValueOnce('mgw_old').mockResolvedValueOnce('mgw_new')
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey })
    expect((await cache.get()).key).toBe('mgw_old')
    cache.invalidate()
    expect((await cache.get()).key).toBe('mgw_new')
  })

  it('does not stampede on concurrent gets', async () => {
    const readKey = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('mgw_k'), 5))
    )
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey })
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(readKey).toHaveBeenCalledTimes(1)
  })

  it('surfaces a missing key as null rather than throwing', async () => {
    const cache = createAuthPolicyCache({ isAuthEnabled: () => true, readKey: async () => null })
    expect(await cache.get()).toEqual({ enabled: true, key: null })
  })
})
