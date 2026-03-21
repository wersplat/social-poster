import { createHmac, timingSafeEqual } from 'crypto'

export type XOAuthPendingPayload = {
  league_id: string
  oauth_token: string
  oauth_token_secret: string
  exp: number
}

const COOKIE_MAX_AGE_SEC = 15 * 60

function getSigningKey(): string {
  const s = process.env.ADMIN_SECRET?.trim()
  if (!s || s === 'changeme') {
    throw new Error(
      '[x oauth] Set a strong ADMIN_SECRET in the environment before using X OAuth linking.'
    )
  }
  return s
}

export function signXOAuthPayload(payload: XOAuthPendingPayload): string {
  const key = getSigningKey()
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyXOAuthCookie(
  value: string | undefined
): XOAuthPendingPayload | null {
  if (!value?.trim()) return null
  const key = getSigningKey()
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = createHmac('sha256', key).update(body).digest('base64url')
  const a = Buffer.from(sig, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as XOAuthPendingPayload
    if (
      typeof parsed.league_id !== 'string' ||
      typeof parsed.oauth_token !== 'string' ||
      typeof parsed.oauth_token_secret !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null
    }
    if (Date.now() > parsed.exp) return null
    return parsed
  } catch {
    return null
  }
}

export function xOAuthCookieHeader(
  signed: string,
  clear: boolean
): { 'Set-Cookie': string } {
  const base = `x_oauth_pending=${clear ? '' : signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : COOKIE_MAX_AGE_SEC}`
  const secure =
    process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === '1'
      ? '; Secure'
      : ''
  return { 'Set-Cookie': `${base}${secure}` }
}
