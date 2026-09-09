import { randomBytes } from 'node:crypto'
import type { OAuthClientConfig, OAuthTokenBundle, OAuthUserInfo } from './types'
import { OAuthTokenClient } from './tokenClient'
import { CallbackServer } from './callbackServer'
import { generatePkcePair, type PkcePair } from './pkce'

export interface OAuthFlowOptions {
  config: OAuthClientConfig
  /** Optional explicit extra params appended to the auth URL, e.g. prompt=consent. */
  extraAuthParams?: Record<string, string>
  /** Browser launcher; defaults to require('node:child_process') opener. */
  openBrowser?: (url: string, state: string) => Promise<void>
  /** Persisted bundle, if a previous token exists (to merge refresh/project info). */
  previousBundle?: OAuthTokenBundle | null
  /** Whether to skip the local callback server (pure URL building). */
  serverless?: boolean
  /** RFC 7636 PKCE support. */
  pkce?: boolean
}

export interface PreparedAuth {
  url: string
  state: string
  /** Valid only when serverless is false. */
  redirectUri?: string
  /** Called by the host after the browser is launched (server must be started first). */
  waitForCallback: () => Promise<{ code: string }>
  /** PKCE pair generated for this flow. Kept in main-process; never over IPC. */
  pkcePair?: PkcePair
}

export interface OAuthCompleted {
  bundle: OAuthTokenBundle
  user: OAuthUserInfo
}

function generateState(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Builds the authorization URL (and optionally spins up a local callback server
 * and waits for the redirect). When `serverless` is true it only returns the
 * URL; the caller owns redirect handling.
 */
export async function prepareAuth(options: OAuthFlowOptions): Promise<PreparedAuth> {
  const { config, extraAuthParams = {}, serverless = false, pkce = false } = options
  const state = generateState()

  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: '',
    scope: config.scopes.join(' '),
    state,
    access_type: 'offline',
    include_granted_scopes: 'true'
  })
  for (const [k, v] of Object.entries(extraAuthParams)) query.set(k, v)

  const pkcePair = pkce ? generatePkcePair() : undefined
  if (pkcePair) {
    query.set('code_challenge', pkcePair.codeChallenge)
    query.set('code_challenge_method', 'S256')
  }

  if (serverless) {
    return {
      url: `${config.authUrl}?${query.toString()}`,
      state,
      pkcePair,
      waitForCallback: async () => {
        throw new Error('serverless auth: no local callback; use a host-managed redirect.')
      }
    }
  }

  const server = new CallbackServer({ state })
  const { redirectUri, wait } = await server.start()
  query.set('redirect_uri', redirectUri)
  return {
    url: `${config.authUrl}?${query.toString()}`,
    state,
    redirectUri,
    pkcePair,
    waitForCallback: async () => {
      try {
        const r = await wait()
        return { code: r.code }
      } finally {
        await server.close()
      }
    }
  }
}

/**
 * Runs the whole device-style flow: builds URL, starts callback server, opens
 * browser, exchanges the code, fetches userinfo, and assembles a token bundle.
 */
export async function runAuthFlow(options: OAuthFlowOptions): Promise<OAuthCompleted> {
  const { config, previousBundle = null } = options
  const prepared = await prepareAuth({ ...options, serverless: false })

  if (options.openBrowser) {
    await options.openBrowser(prepared.url, prepared.state)
  }

  const { code } = await prepared.waitForCallback()
  const client = new OAuthTokenClient(config)
  const pair = await client.exchangeCode(code, prepared.redirectUri!)
  const user = await client.getUserInfo(pair.accessToken)

  const bundle: OAuthTokenBundle = {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken ?? previousBundle?.refreshToken ?? '',
    tokenType: pair.tokenType,
    expiresAt: Date.now() + pair.expiresInSec * 1000,
    idToken: pair.idToken ?? previousBundle?.idToken,
    oauthClientKey: pair.oauthClientKey ?? previousBundle?.oauthClientKey,
    scope: pair.scope ?? previousBundle?.scope,
    projectId: previousBundle?.projectId
  }
  if (!bundle.refreshToken) {
    throw new Error('OAuth flow did not return a refresh_token.')
  }
  return { bundle, user }
}
