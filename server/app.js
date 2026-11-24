import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COOKIE_NAME,
  clearSessionCookie,
  createSessionId,
  createSessionToken,
  hashPassword,
  parseCookies,
  readSessionToken,
  sessionCookie,
  verifyPassword,
} from './auth.js'
import { config } from './config.js'
import { campusFromEmail, db, transaction } from './db.js'
import { createRateLimiter } from './rate-limit.js'
import { asString, parseId } from './validation.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = ['student', 'expert']
const RESPONSE_STATUSES = ['accepted', 'declined']

const publicUser = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        campus: row.campus,
        headline: row.headline,
        expertise: row.expertise,
        status: row.status,
        joinedAt: row.created_at,
      }
    : null

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

const normalizeEmail = (value) => asString(value).trim().toLowerCase()

function issueSession(userId, persistent) {
  const sessionId = createSessionId()
  const expiresAt = Date.now() + config.sessionTtlMs

  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(sessionId, userId, expiresAt)

  const token = createSessionToken(userId, sessionId, expiresAt)
  return { sessionId, cookie: sessionCookie(token, persistent) }
}

function loadSession(req, res, next) {
  req.user = null
  req.sessionId = null

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!token) return next()

  const parsed = readSessionToken(token)
  if (!parsed) {
    res.setHeader('Set-Cookie', clearSessionCookie())
    return next()
  }

  const session = db
    .prepare('SELECT id, user_id, expires_at FROM sessions WHERE id = ?')
    .get(parsed.sessionId)

  const valid =
    session &&
    session.user_id === parsed.userId &&
    Number(session.expires_at) === parsed.expiresAt &&
    Number(session.expires_at) > Date.now()

  if (!valid) {
    if (session) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(parsed.sessionId)
    }
    res.setHeader('Set-Cookie', clearSessionCookie())
    return next()
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(parsed.userId)
  if (!user) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(parsed.sessionId)
    res.setHeader('Set-Cookie', clearSessionCookie())
    return next()
  }

  req.user = user
  req.sessionId = session.id
  next()
}

function requireAuth(req, res, next) {
  if (!req.user) return fail(res, 401, 'Please sign in to continue.')
  next()
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Please sign in to continue.')
    if (!roles.includes(req.user.role)) {
      return fail(res, 403, 'You do not have access to that.')
    }
    next()
  }
}

function listPosts(viewerId) {
  return db
    .prepare(
      `SELECT posts.*, users.name AS author_name, users.role AS author_role,
              users.campus AS author_campus,
              (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS likes,
              EXISTS(
                SELECT 1 FROM post_likes
                WHERE post_id = posts.id AND user_id = ?
              ) AS liked
       FROM posts
       JOIN users ON users.id = posts.author_id
       ORDER BY posts.id DESC
       LIMIT 50`,
    )
    .all(viewerId ?? -1)
    .map((row) => ({
      id: row.id,
      body: row.body,
      tag: row.tag,
      createdAt: row.created_at,
      likes: row.likes,
      liked: Boolean(row.liked),
      author: {
        id: row.author_id,
        name: row.author_name,
        role: row.author_role,
        campus: row.author_campus,
      },
    }))
}

function requestRow(id) {
  return db
    .prepare(
      `SELECT requests.*,
              student.name AS student_name, student.campus AS student_campus,
              expert.name AS expert_name, expert.campus AS expert_campus
       FROM requests
       JOIN users AS student ON student.id = requests.student_id
       JOIN users AS expert  ON expert.id  = requests.expert_id
       WHERE requests.id = ?`,
    )
    .get(id)
}

const shapeRequest = (row) => ({
  id: row.id,
  message: row.message,
  status: row.status,
  createdAt: row.created_at,
  student: {
    id: row.student_id,
    name: row.student_name,
    campus: row.student_campus,
  },
  expert: {
    id: row.expert_id,
    name: row.expert_name,
    campus: row.expert_campus,
  },
})

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', 1)

  app.use(express.json({ limit: '64kb' }))
  app.use(loadSession)

  const loginLimiter = createRateLimiter({
    name: 'login',
    ...config.rateLimit.login,
  })
  const registerLimiter = createRateLimiter({
    name: 'register',
    ...config.rateLimit.register,
  })
  const writeLimiter = createRateLimiter({
    name: 'write',
    ...config.rateLimit.write,
  })

  // ---------- Health ----------

  app.get('/api/health', (_req, res) => {
    let database = 'ok'
    try {
      db.prepare('SELECT 1 AS ok').get()
    } catch {
      database = 'unavailable'
    }

    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      service: 'uniexpert-api',
      database,
      uptime: Math.round(process.uptime()),
    })
  })

  // ---------- Auth ----------

  app.post('/api/auth/register', registerLimiter, (req, res) => {
    const body = req.body ?? {}
    const cleanName = asString(body.name).trim()
    const cleanEmail = normalizeEmail(body.email)
    const password = asString(body.password)
    const role = body.role ?? 'student'
    const cleanHeadline = asString(body.headline).trim()
    const cleanExpertise = asString(body.expertise).trim()

    if (cleanName.length < 2) return fail(res, 400, 'Tell us your full name.')
    if (cleanName.length > 80) {
      return fail(res, 400, 'Keep your name under 80 characters.')
    }
    if (!cleanEmail || cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
      return fail(res, 400, 'That email looks off.')
    }
    if (password.length < 8) {
      return fail(res, 400, 'Use at least 8 characters for your password.')
    }
    if (password.length > 200) {
      return fail(res, 400, 'Keep your password under 200 characters.')
    }
    if (typeof role !== 'string' || !ROLES.includes(role)) {
      return fail(res, 400, 'Pick student or expert.')
    }
    if (cleanHeadline.length > 120) {
      return fail(res, 400, 'Keep your headline under 120 characters.')
    }
    if (cleanExpertise.length > 200) {
      return fail(res, 400, 'Keep your expertise under 200 characters.')
    }

    // Mentor applications need something to show the verification team.
    if (role === 'expert') {
      if (cleanHeadline.length < 4) {
        return fail(res, 400, 'Add a short headline for your mentor profile.')
      }
      if (cleanExpertise.length < 3) {
        return fail(res, 400, 'List at least one area of expertise.')
      }
    }

    const campus = campusFromEmail(cleanEmail)
    if (!campus) {
      return fail(
        res,
        400,
        'UniExpert is university-only — use your .edu or .ac.uk address.',
      )
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(cleanEmail)
    if (existing) return fail(res, 409, 'That email is already registered.')

    // Students on an academic domain are verified automatically. Experts need
    // an admin to confirm their credentials.
    const status = role === 'expert' ? 'pending' : 'verified'

    const result = transaction(() => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, campus, headline, expertise, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          cleanName,
          cleanEmail,
          hashPassword(password),
          role,
          campus,
          cleanHeadline || null,
          cleanExpertise || null,
          status,
        )

      const userId = Number(lastInsertRowid)
      const session = issueSession(userId, true)
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      return { user, cookie: session.cookie }
    })

    res.setHeader('Set-Cookie', result.cookie)
    res.status(201).json({ user: publicUser(result.user) })
  })

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const body = req.body ?? {}
    const email = normalizeEmail(body.email)
    const password = asString(body.password)

    if (!email || email.length > 254 || !password || password.length > 200) {
      return fail(res, 401, 'Wrong email or password — try again.')
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user || !verifyPassword(password, user.password_hash)) {
      return fail(res, 401, 'Wrong email or password — try again.')
    }

    // "Remember me" controls whether the cookie outlives the browser session.
    const remember = body.remember !== false
    const { cookie } = transaction(() => issueSession(user.id, remember))

    res.setHeader('Set-Cookie', cookie)
    res.json({ user: publicUser(user) })
  })

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId)
    }
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.json({ ok: true })
  })

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return fail(res, 401, 'Not signed in.')
    res.json({ user: publicUser(req.user) })
  })

  // ---------- Stats ----------

  app.get('/api/stats', (_req, res) => {
    const one = (sql) => db.prepare(sql).get().value
    res.json({
      experts: one(
        "SELECT COUNT(*) AS value FROM users WHERE role = 'expert' AND status = 'verified'",
      ),
      students: one(
        "SELECT COUNT(*) AS value FROM users WHERE role = 'student'",
      ),
      posts: one('SELECT COUNT(*) AS value FROM posts'),
      mentorships: one('SELECT COUNT(*) AS value FROM requests'),
      campuses: one('SELECT COUNT(DISTINCT campus) AS value FROM users'),
      pending: one(
        "SELECT COUNT(*) AS value FROM users WHERE status = 'pending'",
      ),
    })
  })

  // ---------- Experts ----------

  app.get('/api/experts', (req, res) => {
    const q = asString(req.query.q).trim().toLowerCase().slice(0, 100)
    const rows = db
      .prepare(
        `SELECT * FROM users
         WHERE role = 'expert' AND status = 'verified'
         ORDER BY name`,
      )
      .all()

    const pendingByExpert = new Map()
    if (req.user) {
      const pending = db
        .prepare(
          `SELECT id, expert_id, status FROM requests
           WHERE student_id = ? AND status = 'pending'`,
        )
        .all(req.user.id)
      for (const row of pending) {
        pendingByExpert.set(row.expert_id, { id: row.id, status: row.status })
      }
    }

    const experts = rows
      .filter((row) => {
        if (!q) return true
        return [row.name, row.campus, row.headline, row.expertise]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(q))
      })
      .map((row) => ({
        ...publicUser(row),
        openRequest: pendingByExpert.get(row.id) ?? null,
      }))

    res.json({ experts })
  })

  // ---------- Posts ----------

  app.get('/api/posts', (req, res) => {
    res.json({ posts: listPosts(req.user?.id) })
  })

  app.post('/api/posts', writeLimiter, requireAuth, (req, res) => {
    const body = asString(req.body?.body).trim()
    const tag =
      asString(req.body?.tag).trim().slice(0, 24) || 'General'

    if (body.length < 3) return fail(res, 400, 'Write something first.')
    if (body.length > 600) {
      return fail(res, 400, 'Keep posts under 600 characters.')
    }

    db.prepare('INSERT INTO posts (author_id, body, tag) VALUES (?, ?, ?)').run(
      req.user.id,
      body,
      tag,
    )
    res.status(201).json({ posts: listPosts(req.user.id) })
  })

  app.post('/api/posts/:id/like', requireAuth, (req, res) => {
    const postId = parseId(req.params.id)
    if (!postId) return fail(res, 400, 'That post id is invalid.')

    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)
    if (!post) return fail(res, 404, 'That post no longer exists.')

    const liked = db
      .prepare(
        'SELECT 1 AS hit FROM post_likes WHERE post_id = ? AND user_id = ?',
      )
      .get(postId, req.user.id)

    if (liked) {
      db.prepare(
        'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
      ).run(postId, req.user.id)
    } else {
      db.prepare(
        'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
      ).run(postId, req.user.id)
    }

    res.json({ posts: listPosts(req.user.id) })
  })

  app.delete('/api/posts/:id', requireAuth, (req, res) => {
    const postId = parseId(req.params.id)
    if (!postId) return fail(res, 400, 'That post id is invalid.')

    const post = db
      .prepare('SELECT author_id FROM posts WHERE id = ?')
      .get(postId)
    if (!post) return fail(res, 404, 'That post no longer exists.')
    if (post.author_id !== req.user.id && req.user.role !== 'admin') {
      return fail(res, 403, 'You can only delete your own posts.')
    }

    db.prepare('DELETE FROM posts WHERE id = ?').run(postId)
    res.json({ posts: listPosts(req.user.id) })
  })

  // ---------- Mentorship ----------

  app.get('/api/requests', requireAuth, (req, res) => {
    const incoming = db
      .prepare(
        `SELECT requests.*,
                student.name AS student_name, student.campus AS student_campus,
                expert.name AS expert_name, expert.campus AS expert_campus
         FROM requests
         JOIN users AS student ON student.id = requests.student_id
         JOIN users AS expert  ON expert.id  = requests.expert_id
         WHERE requests.expert_id = ? ORDER BY requests.id DESC`,
      )
      .all(req.user.id)
      .map(shapeRequest)

    const outgoing = db
      .prepare(
        `SELECT requests.*,
                student.name AS student_name, student.campus AS student_campus,
                expert.name AS expert_name, expert.campus AS expert_campus
         FROM requests
         JOIN users AS student ON student.id = requests.student_id
         JOIN users AS expert  ON expert.id  = requests.expert_id
         WHERE requests.student_id = ? ORDER BY requests.id DESC`,
      )
      .all(req.user.id)
      .map(shapeRequest)

    res.json({ incoming, outgoing })
  })

  app.post('/api/requests', writeLimiter, requireAuth, (req, res) => {
    const expertId = parseId(req.body?.expertId)
    const message = asString(req.body?.message).trim()

    if (!expertId) return fail(res, 400, 'Pick a mentor to request.')
    if (message.length < 10) {
      return fail(res, 400, 'Add a sentence about what you need help with.')
    }
    if (message.length > 500) {
      return fail(res, 400, 'Keep the note under 500 characters.')
    }

    const expert = db
      .prepare("SELECT * FROM users WHERE id = ? AND role = 'expert'")
      .get(expertId)
    if (!expert || expert.status !== 'verified') {
      return fail(res, 404, 'That mentor could not be found.')
    }
    if (expert.id === req.user.id) {
      return fail(res, 400, 'You cannot request mentorship from yourself.')
    }

    const duplicate = db
      .prepare(
        `SELECT id FROM requests
         WHERE student_id = ? AND expert_id = ? AND status = 'pending'`,
      )
      .get(req.user.id, expertId)
    if (duplicate) {
      return fail(
        res,
        409,
        'You already have a pending request with this mentor.',
      )
    }

    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO requests (student_id, expert_id, message) VALUES (?, ?, ?)',
      )
      .run(req.user.id, expertId, message)

    res.status(201).json({
      request: shapeRequest(requestRow(Number(lastInsertRowid))),
    })
  })

  app.patch('/api/requests/:id', requireAuth, (req, res) => {
    const requestId = parseId(req.params.id)
    if (!requestId) return fail(res, 400, 'That request id is invalid.')

    const status = asString(req.body?.status)
    if (!RESPONSE_STATUSES.includes(status)) {
      return fail(res, 400, 'Status must be accepted or declined.')
    }

    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
    if (!row) return fail(res, 404, 'That request no longer exists.')
    if (row.expert_id !== req.user.id && req.user.role !== 'admin') {
      return fail(res, 403, 'Only the requested mentor can respond.')
    }
    if (row.status !== 'pending') {
      return fail(res, 409, 'This request has already been answered.')
    }

    db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(
      status,
      row.id,
    )
    res.json({ request: shapeRequest(requestRow(row.id)) })
  })

  // ---------- Admin verification ----------

  app.get('/api/admin/pending', requireRole('admin'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT * FROM users WHERE status = 'pending' ORDER BY created_at`,
      )
      .all()
      .map(publicUser)
    res.json({ users })
  })

  app.patch(
    '/api/admin/users/:id/approve',
    requireRole('admin'),
    (req, res) => {
      const userId = parseId(req.params.id)
      if (!userId) return fail(res, 400, 'That user id is invalid.')

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
      if (!user) return fail(res, 404, 'That user no longer exists.')
      if (user.status === 'verified') {
        return fail(res, 400, 'That account is already verified.')
      }

      db.prepare("UPDATE users SET status = 'verified' WHERE id = ?").run(
        user.id,
      )
      res.json({ user: publicUser({ ...user, status: 'verified' }) })
    },
  )

  // ---------- Static build (production) ----------

  const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
  if (existsSync(join(distDir, 'index.html'))) {
    app.use(express.static(distDir))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(join(distDir, 'index.html'))
    })
  }

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)

    if (error?.type === 'entity.parse.failed') {
      return fail(res, 400, 'Send a valid JSON body.')
    }
    if (error?.type === 'entity.too.large') {
      return fail(res, 413, 'That request is too large.')
    }
    if (error instanceof URIError) {
      return fail(res, 400, 'The request address is malformed.')
    }

    // Translate database constraint violations without exposing SQL details.
    if (error?.errcode === 2067 || error?.errcode === 1555) {
      return fail(res, 409, 'That record already exists.')
    }
    if (error?.errcode === 787) {
      return fail(
        res,
        409,
        'That action references something that no longer exists.',
      )
    }
    if (typeof error?.message === 'string') {
      if (/UNIQUE constraint failed/i.test(error.message)) {
        return fail(res, 409, 'That record already exists.')
      }
      if (/FOREIGN KEY constraint failed/i.test(error.message)) {
        return fail(
          res,
          409,
          'That action references something that no longer exists.',
        )
      }
    }

    console.error(
      `[api] Unhandled error for ${req.method} ${req.originalUrl}`,
      error,
    )
    return fail(res, 500, 'Something went wrong on our end.')
  })

  return app
}
