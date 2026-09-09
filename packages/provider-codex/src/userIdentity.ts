export interface DecodedIdToken {
  sub?: string
  email?: string
  name?: string
}

function b64urlDecode(input: string): string {
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64url').toString('utf-8')
}

/**
 * Codex has no userinfo endpoint, so account identity (email/sub) comes from
 * the `id_token` returned by the token endpoint. Extracts the payload only;
 * signature verification is out of scope (token originates from OpenAI's own
 * token endpoint). Never logs the raw token or payload.
 */
export function decodeIdToken(idToken: string): DecodedIdToken {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid id_token: expected a JWT.')
  const payload = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>
  const out: DecodedIdToken = {}
  if (typeof payload['sub'] === 'string') out.sub = payload['sub']
  if (typeof payload['email'] === 'string') out.email = payload['email']
  if (typeof payload['name'] === 'string') out.name = payload['name']
  return out
}
