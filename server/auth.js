import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

const SECRET = process.env.SESSION_SECRET || 'uniexpert-dev-secret-change-me'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

export const COOKIE_NAME = 'uniexpert_session'

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const candidate = scryptSync(password, salt, 64)
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  )
}

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

// Stateless session token: userId.expiresAt.signature
export function createSessionToken(userId) {
  const payload = `${userId}.${Date.now() + SESSION_TTL_MS}`
  return `${payload}.${sign(payload)}`
}

export function readSessionToken(token) {
  if (!token) return null
  const [id, expires, signature] = String(token).split('.')
  if (!id || !expires || !signature) return null

  const expected = sign(`${id}.${expires}`)
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  if (Number(expires) < Date.now()) return null

  return Number(id)
}

export function parseCookies(header = '') {
  const cookies = {}
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    cookies[part.slice(0, index).trim()] = decodeURIComponent(
      part.slice(index + 1).trim(),
    )
  }
  return cookies
}

export function sessionCookie(token, persistent = true) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (persistent) parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`)
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
