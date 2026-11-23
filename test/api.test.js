import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'

const tempDir = mkdtempSync(join(tmpdir(), 'uniexpert-test-'))

// Configure an isolated database before importing any server module.
process.env.NODE_ENV = 'test'
process.env.DB_PATH = join(tempDir, 'test.db')
process.env.SEED_DEMO_DATA = '0'
process.env.SESSION_SECRET = 'test-only-session-secret-0123456789abcdef'
process.env.RATE_LIMIT_DISABLED = '1'

const { createApp } = await import('../server/app.js')
const { closeDatabase, db } = await import('../server/db.js')
const { createSessionToken, hashPassword } = await import('../server/auth.js')

const PASSWORD = 'password123'
const PASSWORD_HASH = hashPassword(PASSWORD)

let server
let baseUrl
let sequence = 0

before(async () => {
  server = createApp().listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM post_likes;
    DELETE FROM requests;
    DELETE FROM posts;
    DELETE FROM users;
    DELETE FROM sqlite_sequence
      WHERE name IN ('users', 'posts', 'requests');
  `)
  sequence = 0
})

async function http(method, path, { body, rawBody, cookie } = {}) {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (body !== undefined || rawBody !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body:
      rawBody !== undefined
        ? rawBody
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
  })

  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
    cookies: response.headers.getSetCookie?.() ?? [],
  }
}

function sessionSetCookie(response) {
  return (
    response.cookies.find((value) =>
      value.startsWith('uniexpert_session='),
    ) ?? null
  )
}

function cookieValue(response) {
  const raw = sessionSetCookie(response)
  return raw ? raw.split(';')[0] : null
}

function createUser({
  name = 'Test User',
  email,
  role = 'student',
  status = 'verified',
  campus = 'Stanford Campus',
  headline = null,
  expertise = null,
  password = PASSWORD,
} = {}) {
  const finalEmail = email ?? `user${++sequence}@stanford.edu`
  const hash = password === PASSWORD ? PASSWORD_HASH : hashPassword(password)
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, campus, headline, expertise, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(name, finalEmail, hash, role, campus, headline, expertise, status)

  return db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(lastInsertRowid))
}

async function login(user, { remember = true, password = PASSWORD } = {}) {
  const res = await http('POST', '/api/auth/login', {
    body: { email: user.email, password, remember },
  })
  return { res, cookie: cookieValue(res) }
}

async function register(overrides = {}) {
  const body = {
    name: 'New Student',
    email: `new${++sequence}@stanford.edu`,
    password: PASSWORD,
    role: 'student',
    ...overrides,
  }
  const res = await http('POST', '/api/auth/register', { body })
  return { res, cookie: cookieValue(res), email: body.email }
}

function count(table, where = '', params = []) {
  return db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
    .get(...params).count
}

describe('Authentication', () => {
  test('registers a student, verifies the campus, and starts a session', async () => {
    const { res, email, cookie } = await register({ name: 'Ada Lovelace' })

    assert.equal(res.status, 201)
    assert.equal(res.data.user.email, email)
    assert.equal(res.data.user.campus, 'Stanford Campus')
    assert.equal(res.data.user.status, 'verified')
    assert.equal(res.data.user.role, 'student')
    assert.equal(res.data.user.password_hash, undefined)

    const setCookie = sessionSetCookie(res)
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Lax/)
    assert.match(setCookie, /Max-Age=604800/)

    const me = await http('GET', '/api/auth/me', { cookie })
    assert.equal(me.status, 200)
    assert.equal(me.data.user.email, email)
  })

  test('rejects duplicate email registration', async () => {
    await register({ email: 'duplicate@mit.edu' })
    const second = await register({ email: 'duplicate@mit.edu' })

    assert.equal(second.res.status, 409)
    assert.match(second.res.data.error, /already registered/i)
    assert.equal(count('users'), 1)
  })

  test('rejects non-academic email domains', async () => {
    const { res } = await register({ email: 'student@gmail.com' })

    assert.equal(res.status, 400)
    assert.match(res.data.error, /university-only/i)
    assert.equal(count('users'), 0)
  })

  test('logs in with the correct credentials and rejects bad ones', async () => {
    const user = createUser({ email: 'login@stanford.edu' })

    const success = await login(user)
    assert.equal(success.res.status, 200)
    assert.equal(success.res.data.user.id, user.id)
    assert.ok(success.cookie)

    const wrongPassword = await login(user, { password: 'not-the-password' })
    assert.equal(wrongPassword.res.status, 401)

    const unknown = await http('POST', '/api/auth/login', {
      body: { email: 'nobody@stanford.edu', password: PASSWORD },
    })
    assert.equal(unknown.status, 401)
  })

  test('Remember Me controls cookie persistence', async () => {
    const user = createUser({ email: 'remember@stanford.edu' })

    const remembered = await login(user, { remember: true })
    assert.match(sessionSetCookie(remembered.res), /Max-Age=604800/)

    const sessionOnly = await login(user, { remember: false })
    assert.doesNotMatch(sessionSetCookie(sessionOnly.res), /Max-Age/)
    assert.ok(sessionOnly.cookie)
  })

  test('rejects tampered, expired, and revoked sessions', async () => {
    const user = createUser({ email: 'sessions@stanford.edu' })
    const { cookie, res } = await login(user)
    assert.equal(res.status, 200)

    const tampered =
      cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A')
    const bad = await http('GET', '/api/auth/me', { cookie: tampered })
    assert.equal(bad.status, 401)

    const expiredId = 'expiredsession1234567890'
    const expiredAt = Date.now() - 60_000
    db.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    ).run(expiredId, user.id, expiredAt)
    const expiredToken = createSessionToken(
      user.id,
      expiredId,
      expiredAt,
    )
    const expired = await http('GET', '/api/auth/me', {
      cookie: `uniexpert_session=${encodeURIComponent(expiredToken)}`,
    })
    assert.equal(expired.status, 401)

    // A correctly signed token with no database session is revoked.
    const missingId = 'missingsession1234567890'
    const missingToken = createSessionToken(
      user.id,
      missingId,
      Date.now() + 60_000,
    )
    const missing = await http('GET', '/api/auth/me', {
      cookie: `uniexpert_session=${encodeURIComponent(missingToken)}`,
    })
    assert.equal(missing.status, 401)
  })

  test('logout revokes the session, not just the cookie', async () => {
    const user = createUser({ email: 'logout@stanford.edu' })
    const { cookie } = await login(user)
    assert.equal(count('sessions'), 1)

    const logout = await http('POST', '/api/auth/logout', { cookie })
    assert.equal(logout.status, 200)
    assert.equal(count('sessions'), 0)

    const me = await http('GET', '/api/auth/me', { cookie })
    assert.equal(me.status, 401)
  })

  test('malformed cookies are handled safely', async () => {
    const res = await http('GET', '/api/auth/me', {
      cookie: 'uniexpert_session=%E0%A4%A',
    })
    assert.equal(res.status, 401)
  })

  test('production refuses to boot without a strong SESSION_SECRET', () => {
    const configUrl = new URL('../server/config.js', import.meta.url).href
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `import(${JSON.stringify(configUrl)})`],
      {
        env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: '' },
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /SESSION_SECRET/)
  })
})

describe('Authorization', () => {
  test('students cannot use admin endpoints', async () => {
    const student = createUser({ email: 'student@stanford.edu' })
    const { cookie } = await login(student)

    const queue = await http('GET', '/api/admin/pending', { cookie })
    assert.equal(queue.status, 403)

    const approve = await http(
      'PATCH',
      `/api/admin/users/${student.id}/approve`,
      { cookie, body: {} },
    )
    assert.equal(approve.status, 403)
  })

  test('an unverified mentor stays hidden and cannot receive requests', async () => {
    const { res } = await register({
      role: 'expert',
      email: 'pending@mit.edu',
      headline: 'ML researcher',
      expertise: 'Machine Learning',
    })
    assert.equal(res.status, 201)
    assert.equal(res.data.user.status, 'pending')

    const mentorId = res.data.user.id
    const student = createUser({ email: 'asker@stanford.edu' })
    const { cookie } = await login(student)

    const search = await http('GET', '/api/experts')
    assert.equal(
      search.data.experts.some((expert) => expert.id === mentorId),
      false,
    )

    const request = await http('POST', '/api/requests', {
      cookie,
      body: {
        expertId: mentorId,
        message: 'Could you review my research plan please?',
      },
    })
    assert.equal(request.status, 404)
    assert.equal(count('requests'), 0)
  })

  test('admin verification publishes a pending mentor', async () => {
    const pending = createUser({
      email: 'verify@mit.edu',
      name: 'Pending Mentor',
      role: 'expert',
      status: 'pending',
      campus: 'MIT Campus',
      headline: 'Data scientist',
      expertise: 'Data Science',
    })
    const admin = createUser({ email: 'admin@uniexpert.dev', role: 'admin' })
    const { cookie } = await login(admin)

    const queue = await http('GET', '/api/admin/pending', { cookie })
    assert.equal(queue.status, 200)
    assert.ok(queue.data.users.some((user) => user.id === pending.id))

    const approve = await http(
      'PATCH',
      `/api/admin/users/${pending.id}/approve`,
      { cookie, body: {} },
    )
    assert.equal(approve.status, 200)
    assert.equal(approve.data.user.status, 'verified')

    const search = await http('GET', '/api/experts')
    assert.ok(search.data.experts.some((expert) => expert.id === pending.id))
  })

  test('mentor registration rules are enforced by the server', async () => {
    const noHeadline = await register({
      role: 'expert',
      email: 'noheadline@mit.edu',
      expertise: 'Design',
    })
    assert.equal(noHeadline.res.status, 400)

    const noExpertise = await register({
      role: 'expert',
      email: 'noexpertise@mit.edu',
      headline: 'Product designer',
    })
    assert.equal(noExpertise.res.status, 400)

    const escalation = await register({
      role: 'admin',
      email: 'sneaky@mit.edu',
    })
    assert.equal(escalation.res.status, 400)
    assert.equal(count('users'), 0)
  })

  test('only the author or an admin can delete a post', async () => {
    const author = createUser({ email: 'author@stanford.edu' })
    const other = createUser({ email: 'other@stanford.edu' })
    const admin = createUser({ email: 'admin2@uniexpert.dev', role: 'admin' })

    const authorLogin = await login(author)
    const otherLogin = await login(other)
    const adminLogin = await login(admin)

    const created = await http('POST', '/api/posts', {
      cookie: authorLogin.cookie,
      body: { body: 'A post that belongs to me.', tag: 'General' },
    })
    const postId = created.data.posts[0].id

    const forbidden = await http('DELETE', `/api/posts/${postId}`, {
      cookie: otherLogin.cookie,
    })
    assert.equal(forbidden.status, 403)

    const allowed = await http('DELETE', `/api/posts/${postId}`, {
      cookie: adminLogin.cookie,
    })
    assert.equal(allowed.status, 200)
  })

  test('only the requested mentor or an admin can answer a request', async () => {
    const student = createUser({ email: 'ask@stanford.edu' })
    const mentor = createUser({
      email: 'mentor@stanford.edu',
      name: 'Mentor One',
      role: 'expert',
      headline: 'Engineer',
      expertise: 'Systems',
    })
    const otherMentor = createUser({
      email: 'othermentor@mit.edu',
      name: 'Mentor Two',
      role: 'expert',
      campus: 'MIT Campus',
      headline: 'Designer',
      expertise: 'Design',
    })

    const studentLogin = await login(student)
    const otherMentorLogin = await login(otherMentor)

    const created = await http('POST', '/api/requests', {
      cookie: studentLogin.cookie,
      body: {
        expertId: mentor.id,
        message: 'Could you help me with a systems question?',
      },
    })
    assert.equal(created.status, 201)
    const requestId = created.data.request.id

    const byStudent = await http('PATCH', `/api/requests/${requestId}`, {
      cookie: studentLogin.cookie,
      body: { status: 'accepted' },
    })
    assert.equal(byStudent.status, 403)

    const byOtherMentor = await http(
      'PATCH',
      `/api/requests/${requestId}`,
      { cookie: otherMentorLogin.cookie, body: { status: 'accepted' } },
    )
    assert.equal(byOtherMentor.status, 403)
    assert.equal(
      db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId)
        .status,
      'pending',
    )
  })
})

describe('Posts', () => {
  test('creates a valid post and rejects invalid bodies', async () => {
    const student = createUser({ email: 'poster@stanford.edu' })
    const { cookie } = await login(student)

    const created = await http('POST', '/api/posts', {
      cookie,
      body: { body: 'Study group Thursday?', tag: 'Study Group' },
    })
    assert.equal(created.status, 201)
    assert.equal(created.data.posts[0].body, 'Study group Thursday?')
    assert.equal(created.data.posts[0].tag, 'Study Group')

    const short = await http('POST', '/api/posts', {
      cookie,
      body: { body: 'Hi' },
    })
    assert.equal(short.status, 400)

    const long = await http('POST', '/api/posts', {
      cookie,
      body: { body: 'x'.repeat(601) },
    })
    assert.equal(long.status, 400)
  })

  test('toggles likes and reports the correct count', async () => {
    const author = createUser({ email: 'liked@stanford.edu' })
    const reader = createUser({ email: 'liker@stanford.edu' })
    const authorLogin = await login(author)
    const readerLogin = await login(reader)

    const created = await http('POST', '/api/posts', {
      cookie: authorLogin.cookie,
      body: { body: 'Like this if you agree.', tag: 'General' },
    })
    const postId = created.data.posts[0].id

    const liked = await http('POST', `/api/posts/${postId}/like`, {
      cookie: readerLogin.cookie,
    })
    assert.equal(liked.status, 200)
    assert.equal(liked.data.posts[0].likes, 1)
    assert.equal(liked.data.posts[0].liked, true)

    const unliked = await http('POST', `/api/posts/${postId}/like`, {
      cookie: readerLogin.cookie,
    })
    assert.equal(unliked.data.posts[0].likes, 0)
    assert.equal(unliked.data.posts[0].liked, false)
  })

  test('validates post ids and missing posts', async () => {
    const student = createUser({ email: 'ids@stanford.edu' })
    const { cookie } = await login(student)

    const invalid = await http('POST', '/api/posts/not-a-number/like', {
      cookie,
    })
    assert.equal(invalid.status, 400)

    const missing = await http('POST', '/api/posts/999999/like', { cookie })
    assert.equal(missing.status, 404)
  })

  test('deleting a post cascades its likes', async () => {
    const author = createUser({ email: 'cascade@stanford.edu' })
    const reader = createUser({ email: 'cascade2@stanford.edu' })
    const authorLogin = await login(author)
    const readerLogin = await login(reader)

    const created = await http('POST', '/api/posts', {
      cookie: authorLogin.cookie,
      body: { body: 'Temporary post for cascade test.', tag: 'General' },
    })
    const postId = created.data.posts[0].id

    await http('POST', `/api/posts/${postId}/like`, {
      cookie: authorLogin.cookie,
    })
    await http('POST', `/api/posts/${postId}/like`, {
      cookie: readerLogin.cookie,
    })
    assert.equal(
      count('post_likes', 'WHERE post_id = ?', [postId]),
      2,
    )

    const deleted = await http('DELETE', `/api/posts/${postId}`, {
      cookie: authorLogin.cookie,
    })
    assert.equal(deleted.status, 200)
    assert.equal(count('posts'), 0)
    assert.equal(
      count('post_likes', 'WHERE post_id = ?', [postId]),
      0,
    )
  })
})

describe('Mentorship', () => {
  test('creates a request and exposes it to both sides', async () => {
    const student = createUser({ email: 'mentee@stanford.edu' })
    const mentor = createUser({
      email: 'mentor2@stanford.edu',
      role: 'expert',
      headline: 'Researcher',
      expertise: 'ML',
    })
    const studentLogin = await login(student)
    const mentorLogin = await login(mentor)

    const created = await http('POST', '/api/requests', {
      cookie: studentLogin.cookie,
      body: {
        expertId: mentor.id,
        message: 'I would love guidance on my thesis topic.',
      },
    })
    assert.equal(created.status, 201)
    assert.equal(created.data.request.student.id, student.id)
    assert.equal(created.data.request.expert.id, mentor.id)
    assert.equal(created.data.request.status, 'pending')

    const outgoing = await http('GET', '/api/requests', {
      cookie: studentLogin.cookie,
    })
    assert.equal(outgoing.data.outgoing.length, 1)

    const incoming = await http('GET', '/api/requests', {
      cookie: mentorLogin.cookie,
    })
    assert.equal(incoming.data.incoming.length, 1)
  })

  test('rejects duplicate pending requests and self requests', async () => {
    const student = createUser({ email: 'dupe@stanford.edu' })
    const mentor = createUser({
      email: 'dupe-mentor@stanford.edu',
      role: 'expert',
      headline: 'Advisor',
      expertise: 'Economics',
    })
    const studentLogin = await login(student)
    const mentorLogin = await login(mentor)

    const body = {
      expertId: mentor.id,
      message: 'Could we talk about my research question?',
    }
    const first = await http('POST', '/api/requests', {
      cookie: studentLogin.cookie,
      body,
    })
    assert.equal(first.status, 201)

    const duplicate = await http('POST', '/api/requests', {
      cookie: studentLogin.cookie,
      body,
    })
    assert.equal(duplicate.status, 409)

    const self = await http('POST', '/api/requests', {
      cookie: mentorLogin.cookie,
      body: {
        expertId: mentor.id,
        message: 'Requesting mentorship from myself.',
      },
    })
    assert.equal(self.status, 400)
  })

  test('accepts and declines pending requests once', async () => {
    const student = createUser({ email: 'decision@stanford.edu' })
    const otherStudent = createUser({ email: 'decision2@stanford.edu' })
    const mentor = createUser({
      email: 'decision-mentor@stanford.edu',
      role: 'expert',
      headline: 'Founder',
      expertise: 'Startups',
    })
    const studentLogin = await login(student)
    const otherLogin = await login(otherStudent)
    const mentorLogin = await login(mentor)

    const accepted = await http('POST', '/api/requests', {
      cookie: studentLogin.cookie,
      body: {
        expertId: mentor.id,
        message: 'I need help with fundraising.',
      },
    })
    const acceptedId = accepted.data.request.id

    const accept = await http('PATCH', `/api/requests/${acceptedId}`, {
      cookie: mentorLogin.cookie,
      body: { status: 'accepted' },
    })
    assert.equal(accept.status, 200)
    assert.equal(accept.data.request.status, 'accepted')

    const again = await http('PATCH', `/api/requests/${acceptedId}`, {
      cookie: mentorLogin.cookie,
      body: { status: 'declined' },
    })
    assert.equal(again.status, 409)

    const declined = await http('POST', '/api/requests', {
      cookie: otherLogin.cookie,
      body: {
        expertId: mentor.id,
        message: 'Could you look at my pitch deck?',
      },
    })
    const decline = await http(
      'PATCH',
      `/api/requests/${declined.data.request.id}`,
      { cookie: mentorLogin.cookie, body: { status: 'declined' } },
    )
    assert.equal(decline.status, 200)
    assert.equal(decline.data.request.status, 'declined')
  })

  test('validates request ids, statuses, and targets', async () => {
    const student = createUser({ email: 'validate@stanford.edu' })
    const { cookie } = await login(student)

    const badId = await http('PATCH', '/api/requests/nope', {
      cookie,
      body: { status: 'accepted' },
    })
    assert.equal(badId.status, 400)

    const badStatus = await http('PATCH', '/api/requests/1', {
      cookie,
      body: { status: 'approved' },
    })
    assert.equal(badStatus.status, 400)

    const badExpert = await http('POST', '/api/requests', {
      cookie,
      body: { expertId: 'nope', message: 'A long enough message.' },
    })
    assert.equal(badExpert.status, 400)

    const shortMessage = await http('POST', '/api/requests', {
      cookie,
      body: { expertId: 1, message: 'short' },
    })
    assert.equal(shortMessage.status, 400)
  })
})

describe('Data integrity and API reliability', () => {
  test('foreign keys are enforced', () => {
    assert.equal(
      db.prepare('PRAGMA foreign_keys').get().foreign_keys,
      1,
    )

    const student = createUser({ email: 'fk@stanford.edu' })
    assert.throws(
      () =>
        db
          .prepare(
            'INSERT INTO requests (student_id, expert_id, message) VALUES (?, ?, ?)',
          )
          .run(student.id, 999999, 'Orphan request message.'),
      /FOREIGN KEY constraint failed/,
    )
  })

  test('unique emails are enforced at the database level', () => {
    createUser({ email: 'unique@stanford.edu' })
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO users (name, email, password_hash, role, campus, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'Duplicate',
            'unique@stanford.edu',
            PASSWORD_HASH,
            'student',
            'Stanford Campus',
            'verified',
          ),
      /UNIQUE constraint failed/,
    )
  })

  test('statistics track approvals, posts, and requests', async () => {
    const admin = createUser({ email: 'stats-admin@uniexpert.dev', role: 'admin' })
    const adminLogin = await login(admin)

    const student = await register({ email: 'stats@stanford.edu' })
    const mentor = await register({
      role: 'expert',
      email: 'stats-mentor@mit.edu',
      headline: 'Data scientist',
      expertise: 'SQL',
    })

    let stats = await http('GET', '/api/stats')
    assert.equal(stats.data.students, 1)
    assert.equal(stats.data.experts, 0)
    assert.equal(stats.data.pending, 1)
    assert.equal(stats.data.campuses, 2)

    await http('PATCH', `/api/admin/users/${mentor.res.data.user.id}/approve`, {
      cookie: adminLogin.cookie,
      body: {},
    })
    await http('POST', '/api/posts', {
      cookie: student.cookie,
      body: { body: 'Counting this post.', tag: 'General' },
    })
    await http('POST', '/api/requests', {
      cookie: student.cookie,
      body: {
        expertId: mentor.res.data.user.id,
        message: 'Help me understand the data pipeline.',
      },
    })

    stats = await http('GET', '/api/stats')
    assert.equal(stats.data.students, 1)
    assert.equal(stats.data.experts, 1)
    assert.equal(stats.data.pending, 0)
    assert.equal(stats.data.posts, 1)
    assert.equal(stats.data.mentorships, 1)
  })

  test('returns consistent JSON errors for bad input and unknown routes', async () => {
    const malformed = await http('POST', '/api/auth/login', {
      rawBody: '{"email":',
    })
    assert.equal(malformed.status, 400)
    assert.match(malformed.data.error, /valid JSON/i)

    const missing = await http('GET', '/api/does-not-exist')
    assert.equal(missing.status, 404)
    assert.match(missing.data.error, /No route/)

    const health = await http('GET', '/api/health')
    assert.equal(health.status, 200)
    assert.equal(health.data.status, 'ok')
    assert.equal(health.data.database, 'ok')
  })
})
