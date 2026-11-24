import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { config } from './config.js'

export const COOKIE_NAME = 'uniexpert_session'

const ID_RE = /^[1-9]\d{0,11}$/
const EXPIRES_RE = /^\d{1,16}$/
const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/
const MAX_TOKEN_LENGTH = 200

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false

  const [salt, hash] = stored.split(':')
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return false

  const expected = Buffer.from(hash, 'hex')
  if (expected.length !== 64) return false

  try {
    const candidate = scryptSync(password, salt, 64)
    return timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

export function createSessionId() {
  return randomBytes(18).toString('base64url')
}

function sign(payload) {
  return createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url')
}

// Session token: userId.sessionId.expiresAt.signature
export function createSessionToken(userId, sessionId, expiresAt) {
  const payload = `${userId}.${sessionId}.${expiresAt}`
  return `${payload}.${sign(payload)}`
}

export function readSessionToken(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null

  const parts = token.split('.')
  if (parts.length !== 4) return null

  const [id, sessionId, expires, signature] = parts
  if (!ID_RE.test(id) || !SESSION_ID_RE.test(sessionId)) return null
  if (!EXPIRES_RE.test(expires) || !SIGNATURE_RE.test(signature)) return null

  const userId = Number(id)
  const expiresAt = Number(expires)
  const now = Date.now()

  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null
  // Tokens are only ever minted with the configured lifetime. Reject anything
  // claiming an implausible expiry, which also bounds replay windows.
  if (expiresAt > now + config.sessionTtlMs + 60_000) return null

  const expected = sign(`${id}.${sessionId}.${expires}`)
  if (signature.length !== expected.length) return null
  if (
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null
  }

  return { userId, sessionId, expiresAt }
}

export function parseCookies(header = '') {
  const cookies = Object.create(null)

  for (const part of String(header).split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue

    const name = part.slice(0, index).trim()
    if (!name) continue

    let value = part.slice(index + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }

    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      // A malformed cookie must not take down the request.
      cookies[name] = value
    }
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
  if (persistent) {
    parts.push(`Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`)
  }
  if (config.isProduction) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie() {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (config.isProduction) parts.push('Secure')
  return parts.join('; ')
}
