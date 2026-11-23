import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  parseCookies,
  readSessionToken,
  sessionCookie,
  verifyPassword,
  COOKIE_NAME,
} from './auth.js'
import { campusFromEmail, db, seed } from './db.js'

seed()

const app = express()
const PORT = Number(process.env.PORT) || 4000

app.use(express.json({ limit: '64kb' }))

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

app.use((req, _res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  const id = readSessionToken(token)
  req.user = id
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null
    : null
  next()
})

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------- Auth ----------

app.post('/api/auth/register', (req, res) => {
  const {
    name = '',
    email = '',
    password = '',
    role = 'student',
    headline = '',
    expertise = '',
  } = req.body ?? {}

  const cleanName = String(name).trim()
  const cleanEmail = String(email).trim().toLowerCase()

  if (cleanName.length < 2) return fail(res, 400, 'Tell us your full name.')
  if (!EMAIL_RE.test(cleanEmail)) return fail(res, 400, 'That email looks off.')
  if (String(password).length < 8) {
    return fail(res, 400, 'Use at least 8 characters for your password.')
  }
  if (!['student', 'expert'].includes(role)) {
    return fail(res, 400, 'Pick student or expert.')
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

  // Students on an academic domain are verified automatically.
  // Experts need an admin to confirm their credentials.
  const status = role === 'expert' ? 'pending' : 'verified'

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, campus, headline, expertise, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cleanName,
      cleanEmail,
      hashPassword(String(password)),
      role,
      campus,
      String(headline).trim() || null,
      String(expertise).trim() || null,
      status,
    )

  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(lastInsertRowid))

  res.setHeader('Set-Cookie', sessionCookie(createSessionToken(user.id)))
  res.status(201).json({ user: publicUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const { email = '', password = '' } = req.body ?? {}
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase())

  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return fail(res, 401, 'Wrong email or password — try again.')
  }

  // "Remember me" controls whether the cookie outlives the browser session.
  res.setHeader(
    'Set-Cookie',
    sessionCookie(createSessionToken(user.id), req.body?.remember !== false),
  )
  res.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', (_req, res) => {
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
    students: one("SELECT COUNT(*) AS value FROM users WHERE role = 'student'"),
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
  const q = String(req.query.q ?? '').trim().toLowerCase()
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE role = 'expert' AND status = 'verified'
       ORDER BY name`,
    )
    .all()

  const experts = rows
    .filter((row) => {
      if (!q) return true
      return [row.name, row.campus, row.headline, row.expertise]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    })
    .map((row) => ({
      ...publicUser(row),
      openRequest: req.user
        ? db
            .prepare(
              `SELECT id, status FROM requests
               WHERE student_id = ? AND expert_id = ? AND status = 'pending'`,
            )
            .get(req.user.id, row.id) || null
        : null,
    }))

  res.json({ experts })
})

// ---------- Posts ----------

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

app.get('/api/posts', (req, res) => {
  res.json({ posts: listPosts(req.user?.id) })
})

app.post('/api/posts', requireAuth, (req, res) => {
  const body = String(req.body?.body ?? '').trim()
  const tag = String(req.body?.tag ?? 'General').trim().slice(0, 24) || 'General'

  if (body.length < 3) return fail(res, 400, 'Write something first.')
  if (body.length > 600) return fail(res, 400, 'Keep posts under 600 characters.')

  db.prepare('INSERT INTO posts (author_id, body, tag) VALUES (?, ?, ?)').run(
    req.user.id,
    body,
    tag,
  )
  res.status(201).json({ posts: listPosts(req.user.id) })
})

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const postId = Number(req.params.id)
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)
  if (!post) return fail(res, 404, 'That post no longer exists.')

  const liked = db
    .prepare('SELECT 1 AS hit FROM post_likes WHERE post_id = ? AND user_id = ?')
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
  const post = db
    .prepare('SELECT author_id FROM posts WHERE id = ?')
    .get(Number(req.params.id))
  if (!post) return fail(res, 404, 'That post no longer exists.')
  if (post.author_id !== req.user.id && req.user.role !== 'admin') {
    return fail(res, 403, 'You can only delete your own posts.')
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(Number(req.params.id))
  res.json({ posts: listPosts(req.user.id) })
})

// ---------- Mentorship ----------

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
  student: { id: row.student_id, name: row.student_name, campus: row.student_campus },
  expert: { id: row.expert_id, name: row.expert_name, campus: row.expert_campus },
})

app.get('/api/requests', requireAuth, (req, res) => {
  const incoming = db
    .prepare(
      `SELECT * FROM (
         SELECT requests.*, student.name AS student_name, student.campus AS student_campus,
                expert.name AS expert_name, expert.campus AS expert_campus
         FROM requests
         JOIN users AS student ON student.id = requests.student_id
         JOIN users AS expert  ON expert.id  = requests.expert_id
       ) WHERE expert_id = ? ORDER BY id DESC`,
    )
    .all(req.user.id)
    .map(shapeRequest)

  const outgoing = db
    .prepare(
      `SELECT * FROM (
         SELECT requests.*, student.name AS student_name, student.campus AS student_campus,
                expert.name AS expert_name, expert.campus AS expert_campus
         FROM requests
         JOIN users AS student ON student.id = requests.student_id
         JOIN users AS expert  ON expert.id  = requests.expert_id
       ) WHERE student_id = ? ORDER BY id DESC`,
    )
    .all(req.user.id)
    .map(shapeRequest)

  res.json({ incoming, outgoing })
})

app.post('/api/requests', requireAuth, (req, res) => {
  const expertId = Number(req.body?.expertId)
  const message = String(req.body?.message ?? '').trim()

  const expert = db
    .prepare("SELECT * FROM users WHERE id = ? AND role = 'expert'")
    .get(expertId)
  if (!expert) return fail(res, 404, 'That mentor could not be found.')
  if (expert.id === req.user.id) {
    return fail(res, 400, 'You cannot request mentorship from yourself.')
  }
  if (message.length < 10) {
    return fail(res, 400, 'Add a sentence about what you need help with.')
  }
  if (message.length > 500) {
    return fail(res, 400, 'Keep the note under 500 characters.')
  }

  const duplicate = db
    .prepare(
      `SELECT id FROM requests
       WHERE student_id = ? AND expert_id = ? AND status = 'pending'`,
    )
    .get(req.user.id, expertId)
  if (duplicate) {
    return fail(res, 409, 'You already have a pending request with this mentor.')
  }

  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO requests (student_id, expert_id, message) VALUES (?, ?, ?)',
    )
    .run(req.user.id, expertId, message)

  res.status(201).json({
    request: shapeRequest(requestRow(Number(lastInsertRowid), req.user.id)),
  })
})

app.patch('/api/requests/:id', requireAuth, (req, res) => {
  const status = String(req.body?.status ?? '')
  if (!['accepted', 'declined'].includes(status)) {
    return fail(res, 400, 'Status must be accepted or declined.')
  }

  const row = db
    .prepare('SELECT * FROM requests WHERE id = ?')
    .get(Number(req.params.id))
  if (!row) return fail(res, 404, 'That request no longer exists.')
  if (row.expert_id !== req.user.id && req.user.role !== 'admin') {
    return fail(res, 403, 'Only the requested mentor can respond.')
  }

  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(
    status,
    row.id,
  )
  res.json({ request: shapeRequest(requestRow(row.id, req.user.id)) })
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

app.patch('/api/admin/users/:id/approve', requireRole('admin'), (req, res) => {
  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(req.params.id))
  if (!user) return fail(res, 404, 'That user no longer exists.')
  if (user.status === 'verified') {
    return fail(res, 400, 'That account is already verified.')
  }
  db.prepare("UPDATE users SET status = 'verified' WHERE id = ?").run(user.id)
  res.json({ user: publicUser({ ...user, status: 'verified' }) })
})

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

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  console.error(error)
  res.status(500).json({ error: 'Something went wrong on our end.' })
})

app.listen(PORT, () => {
  console.log(`UniExpert API listening on http://localhost:${PORT}`)
})
