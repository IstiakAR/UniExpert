import { fileURLToPath } from 'node:url'

const env = process.env

function readInt(name, fallback, { min = 0 } = {}) {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}.`)
  }
  return value
}

const isProduction = env.NODE_ENV === 'production'
const isTest = env.NODE_ENV === 'test'

// Development and test runs get a predictable secret so sessions survive a
// restart. Production must provide its own secret — there is no fallback.
const DEV_SECRET = 'uniexpert-development-only-secret-do-not-use-in-production'
if (
  isProduction &&
  (typeof env.SESSION_SECRET !== 'string' ||
    env.SESSION_SECRET.trim().length < 32)
) {
  throw new Error(
    'SESSION_SECRET must be set to at least 32 characters when NODE_ENV=production.',
  )
}

const sessionTtlDays = readInt('SESSION_TTL_DAYS', 7, { min: 1 })
const port = readInt('PORT', 4000, { min: 1 })
if (port > 65535) throw new Error('PORT must be between 1 and 65535.')

const databasePath =
  env.DB_PATH || fileURLToPath(new URL('./data/uniexpert.db', import.meta.url))

export const config = Object.freeze({
  isProduction,
  isTest,
  port,
  databasePath,
  seedDemoData:
    env.SEED_DEMO_DATA !== '0' && env.SEED_DEMO_DATA !== 'false',
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  sessionSecret: env.SESSION_SECRET || DEV_SECRET,
  sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1000,
  rateLimit: Object.freeze({
    disabled:
      env.RATE_LIMIT_DISABLED === '1' ||
      env.RATE_LIMIT_DISABLED === 'true',
    login: Object.freeze({
      windowMs: readInt('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, {
        min: 1000,
      }),
      max: readInt('LOGIN_RATE_LIMIT_MAX', 20, { min: 1 }),
    }),
    register: Object.freeze({
      windowMs: readInt('REGISTER_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000, {
        min: 1000,
      }),
      max: readInt('REGISTER_RATE_LIMIT_MAX', 10, { min: 1 }),
    }),
    write: Object.freeze({
      windowMs: readInt('WRITE_RATE_LIMIT_WINDOW_MS', 60 * 1000, {
        min: 1000,
      }),
      max: readInt('WRITE_RATE_LIMIT_MAX', 60, { min: 1 }),
    }),
  }),
})
