import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './auth.js'

const dataDir = fileURLToPath(new URL('./data/', import.meta.url))
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(`${dataDir}uniexpert.db`)

db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

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
`)

const KNOWN_CAMPUSES = {
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
  const domain = String(email).split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  if (KNOWN_CAMPUSES[domain]) return `${KNOWN_CAMPUSES[domain]} Campus`
  if (/\.edu$|\.ac\.uk$|\.edu\.in$|\.ac\.nz$/.test(domain)) {
    return `${domain.split('.')[0].toUpperCase()} Campus`
  }
  return null
}

export function seed() {
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM users')
    .get()
  if (count > 0) return

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, campus, headline, expertise, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertPost = db.prepare(
    'INSERT INTO posts (author_id, body, tag) VALUES (?, ?, ?)',
  )
  const insertRequest = db.prepare(
    'INSERT INTO requests (student_id, expert_id, message) VALUES (?, ?, ?)',
  )

  const demo = hashPassword('campus1234')
  const admin = hashPassword('admin1234')

  const people = [
    ['Dr. Elena Park', 'elena@stanford.edu', demo, 'expert', 'Stanford Campus', 'ML researcher · Human-centered AI', 'Machine Learning, Python, Research', 'verified'],
    ['Marcus Reid', 'marcus@mit.edu', demo, 'expert', 'MIT Campus', 'Product designer at Figma', 'Design, Figma, Product', 'verified'],
    ['Priya Nair', 'priya@berkeley.edu', demo, 'expert', 'UC Berkeley Campus', 'Backend engineer at Stripe', 'Node.js, Systems, Interviews', 'verified'],
    ['Tom Whitfield', 'tom@ox.ac.uk', demo, 'expert', 'Oxford Campus', 'PhD candidate, Economics', 'Economics, Data Analysis', 'verified'],
    ['Sara Ortiz', 'sara@harvard.edu', demo, 'expert', 'Harvard Campus', 'MD candidate, Harvard Medical', 'Medicine, Research, Admissions', 'verified'],
    ['Jonas Berg', 'jonas@cam.ac.uk', demo, 'expert', 'Cambridge Campus', 'Founder, seed-stage SaaS', 'Entrepreneurship, Fundraising', 'verified'],
    ['Alex Rivera', 'alex@stanford.edu', demo, 'student', 'Stanford Campus', 'CS junior · looking for ML mentors', null, 'verified'],
    ['Maya Chen', 'maya@mit.edu', demo, 'student', 'MIT Campus', 'Design + HCI, class of 2027', null, 'verified'],
    ['Dan Osei', 'dan@berkeley.edu', demo, 'student', 'UC Berkeley Campus', 'EECS senior, backend curious', null, 'verified'],
    ['Campus Admin', 'admin@uniexpert.dev', admin, 'admin', 'UniExpert HQ', 'Platform verification team', null, 'verified'],
    ['Ife Adeyemi', 'ife@columbia.edu', demo, 'expert', 'Columbia Campus', 'Data scientist at Spotify', 'Data Science, SQL, Careers', 'pending'],
  ]

  const ids = {}
  for (const person of people) {
    const { lastInsertRowid } = insertUser.run(...person)
    ids[person[1]] = Number(lastInsertRowid)
  }

  insertPost.run(
    ids['elena@stanford.edu'],
    'Office hours are open this Friday. Bring a paper you want to tear apart — first-years very welcome.',
    'Research',
  )
  insertPost.run(
    ids['marcus@mit.edu'],
    'Portfolio review thread: drop a link and I will give you three concrete fixes, no fluff.',
    'Design',
  )
  insertPost.run(
    ids['priya@berkeley.edu'],
    'Interviewed 40 new grads this quarter. The thing that separates offers: you can explain a tradeoff you chose.',
    'Careers',
  )
  insertPost.run(
    ids['alex@stanford.edu'],
    'Anyone else taking CS229 this fall and want to form a study group? Thinking Thursdays in Green Library.',
    'Study Group',
  )
  insertPost.run(
    ids['tom@ox.ac.uk'],
    'Reminder that the economics seminar series is streaming — the causal inference session is the one to catch.',
    'Events',
  )

  db.prepare(
    'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
  ).run(1, ids['maya@mit.edu'])
  db.prepare(
    'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
  ).run(3, ids['dan@berkeley.edu'])
  db.prepare(
    'INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)',
  ).run(3, ids['alex@stanford.edu'])

  insertRequest.run(
    ids['maya@mit.edu'],
    ids['elena@stanford.edu'],
    'Hi Dr. Park — I am working on a HCI thesis about model explanations and would love 20 minutes of your perspective.',
  )
}
