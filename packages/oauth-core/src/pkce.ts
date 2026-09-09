import { createHash, randomBytes } from 'node:crypto'

export interface PkcePair {
  codeVerifier: string
  codeChallenge: string
}

/** RFC 7636 PKCE S256 pair. codeVerifier kept in main-process; never over IPC. */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}
