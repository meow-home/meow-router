import { describe, it, expect } from 'vitest'
import { CallbackServer } from './callbackServer'

async function request(url: string): Promise<number> {
  const res = await fetch(url)
  return res.status
}

describe('CallbackServer', () => {
  it('returns redirectUri on the bound loopback port', async () => {
    const srv = new CallbackServer({ state: 'ST' })
    const { port, redirectUri } = await srv.start()
    expect(port).toBeGreaterThan(0)
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth-callback$/)
    await srv.close()
  })

  it('resolves a callback whose code+state match, then closes', async () => {
    const srv = new CallbackServer({ state: 'ST', timeoutMs: 5000 })
    const { redirectUri, wait } = await srv.start()
    const waitP = wait()
    const status = await request(`${redirectUri}?code=ABC&state=ST`)
    expect(status).toBe(200)
    const res = await waitP
    expect(res.code).toBe('ABC')
    expect(res.state).toBe('ST')
    await srv.close()
  })

  it('rejects on state mismatch', async () => {
    const srv = new CallbackServer({ state: 'ST', timeoutMs: 5000 })
    const { redirectUri, wait } = await srv.start()
    const waitP = wait()
    await request(`${redirectUri}?code=ABC&state=WRONG`)
    await expect(waitP).rejects.toMatchObject({ code: 'state_mismatch' })
  })

  it('rejects on oauth error param', async () => {
    const srv = new CallbackServer({ state: 'ST', timeoutMs: 5000 })
    const { redirectUri, wait } = await srv.start()
    const waitP = wait()
    await request(`${redirectUri}?error=access_denied`)
    await expect(waitP).rejects.toMatchObject({ code: 'access_denied' })
  })

  it('binds a fixed port and uses redirectHost in the redirect URI', async () => {
    const srv = new CallbackServer({
      state: 'ST',
      host: '127.0.0.1',
      redirectHost: 'localhost',
      port: 1455,
      callbackPath: '/auth/callback'
    })
    const { port, redirectUri } = await srv.start()
    expect(port).toBe(1455)
    expect(redirectUri).toBe('http://localhost:1455/auth/callback')
    await srv.close()
  })
})
