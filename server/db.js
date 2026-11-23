import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hashPassword } from './auth.js'
import { config } from './config.js'

if (config.isTest && !process.env.DB_PATH) {
  throw new Error(
    'Refusing to open the development database in tests. Set DB_PATH to a temporary file.',
  )
}

if (config.databasePath !== ':memory:') {
  mkdirSync(dirname(config.databasePath), { recursive: true })
}

export const db = new DatabaseSync(config.databasePath)

db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
db.exec('PRAGMA busy_timeout = 5000;')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'student',
    campus        TEXT    NOT NULL,
    headline      TEXT,
    expertise     TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending',
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    tag        TEXT,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expert_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'pending',
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
  CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id);
  CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id, status);
  CREATE INDEX IF NOT EXISTS idx_requests_expert ON requests(expert_id, status);
`)

// Runs synchronous database work in a transaction and rolls back on failure.
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The original error is the one worth reporting.
    }
    throw error
  }
}

export function closeDatabase() {
  db.close()
}

const KNOWN_CAMPUSES = {
  'du.ac.bd': 'University of Dhaka',
  'stanford.edu': 'Stanford',
  'mit.edu': 'MIT',
  'berkeley.edu': 'UC Berkeley',
  'harvard.edu': 'Harvard',
  'ox.ac.uk': 'Oxford',
  'cam.ac.uk': 'Cambridge',
  'columbia.edu': 'Columbia',
  'nyu.edu': 'NYU',
  'ucla.edu': 'UCLA',
}

// The university-exclusive gate: only academic domains get an account.
export function campusFromEmail(email) {
  if (typeof email !== 'string' || email.length > 254) return null

  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain || domain.length > 253) return null

  if (KNOWN_CAMPUSES[domain]) return `${KNOWN_CAMPUSES[domain]} Campus`
  if (/\.edu$|\.ac\.uk$|\.edu\.in$|\.ac\.nz$|\.ac\.bd$|\.edu\.bd$/.test(domain)) {
    return `${domain.split('.')[0].toUpperCase()} Campus`
  }
  return null
}

export function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get()
  if (count > 0) return false

  const demo = hashPassword('campus1234')
  const admin = hashPassword('admin1234')

  return transaction(() => {
    // Re-check inside the transaction so two concurrent first boots cannot
    // both seed the database.
    const again = db.prepare('SELECT COUNT(*) AS count FROM users').get()
    if (again.count > 0) return false

    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, campus, headline, expertise, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertPost = db.prepare(
      'INSERT INTO posts (author_id, body, tag) VALUES (?, ?, ?)',
    )
    const insertLike = db.prepare(
      'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
    )
    const insertRequest = db.prepare(
      'INSERT INTO requests (student_id, expert_id, message) VALUES (?, ?, ?)',
    )

    const people = [
      ['Dr. Elena Park', 'elena@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'ML researcher · Human-centered AI', 'Machine Learning, Python, Research', 'verified'],
      ['Marcus Reid', 'marcus@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'Product designer at Figma', 'Design, Figma, Product', 'verified'],
      ['Priya Nair', 'priya@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'Backend engineer at Stripe', 'Node.js, Systems, Interviews', 'verified'],
      ['Tom Whitfield', 'tom@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'PhD candidate, Economics', 'Economics, Data Analysis', 'verified'],
      ['Sara Ortiz', 'sara@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'MD candidate, Harvard Medical', 'Medicine, Research, Admissions', 'verified'],
      ['Jonas Berg', 'jonas@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'Founder, seed-stage SaaS', 'Entrepreneurship, Fundraising', 'verified'],
      ['Alex Rivera', 'alex@du.ac.bd', demo, 'student', 'University of Dhaka Campus', 'CS junior · looking for ML mentors', null, 'verified'],
      ['Maya Chen', 'maya@du.ac.bd', demo, 'student', 'University of Dhaka Campus', 'Design + HCI, class of 2027', null, 'verified'],
      ['Dan Osei', 'dan@du.ac.bd', demo, 'student', 'University of Dhaka Campus', 'EECS senior, backend curious', null, 'verified'],
      ['Campus Admin', 'admin@uniexpert.dev', admin, 'admin', 'UniExpert HQ', 'Platform verification team', null, 'verified'],
      ['Ife Adeyemi', 'ife@du.ac.bd', demo, 'expert', 'University of Dhaka Campus', 'Data scientist at Spotify', 'Data Science, SQL, Careers', 'pending'],
    ]

    const ids = {}
    for (const person of people) {
      const { lastInsertRowid } = insertUser.run(...person)
      ids[person[1]] = Number(lastInsertRowid)
    }

    const postIds = [
      insertPost.run(
        ids['elena@du.ac.bd'],
        'Office hours are open this Friday. Bring a paper you want to tear apart — first-years very welcome.',
        'Research',
      ).lastInsertRowid,
      insertPost.run(
        ids['marcus@du.ac.bd'],
        'Portfolio review thread: drop a link and I will give you three concrete fixes, no fluff.',
        'Design',
      ).lastInsertRowid,
      insertPost.run(
        ids['priya@du.ac.bd'],
        'Interviewed 40 new grads this quarter. The thing that separates offers: you can explain a tradeoff you chose.',
        'Careers',
      ).lastInsertRowid,
      insertPost.run(
        ids['alex@du.ac.bd'],
        'Anyone else taking CS229 this fall and want to form a study group? Thinking Thursdays in Green Library.',
        'Study Group',
      ).lastInsertRowid,
      insertPost.run(
        ids['tom@du.ac.bd'],
        'Reminder that the economics seminar series is streaming — the causal inference session is the one to catch.',
        'Events',
      ).lastInsertRowid,
    ].map(Number)

    insertLike.run(postIds[0], ids['maya@du.ac.bd'])
    insertLike.run(postIds[2], ids['dan@du.ac.bd'])
    insertLike.run(postIds[2], ids['alex@du.ac.bd'])

    insertRequest.run(
      ids['maya@du.ac.bd'],
      ids['elena@du.ac.bd'],
      'Hi Dr. Park — I am working on a HCI thesis about model explanations and would love 20 minutes of your perspective.',
    )

    return true
  })
}
