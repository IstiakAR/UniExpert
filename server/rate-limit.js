import { config } from './config.js'

// In-memory fixed-window limiter. It is intentionally simple: the app runs as
// a single Node process, and this is abuse mitigation rather than accounting.
const buckets = new Map()
let lookups = 0

function prune(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function createRateLimiter({ name, windowMs, max }) {
  if (config.rateLimit.disabled) {
    return (_req, _res, next) => next()
  }

  return (req, res, next) => {
    const now = Date.now()
    lookups += 1
    if (lookups % 500 === 0 || buckets.size > 5000) prune(now)

    const key = `${name}:${req.ip || req.socket?.remoteAddress || 'unknown'}`
    let bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: 'Too many attempts. Please wait a moment and try again.',
      })
    }

    next()
  }
}

export function resetRateLimits() {
  buckets.clear()
}
