# UniExpert

University-exclusive mentorship network: React + Vite front end, Express API,
and a relational SQLite database (Node's built-in `node:sqlite`) — no native
build step and no external service to configure.

Requires Node 24+ (for `node:sqlite` and `--env-file-if-exists`).

## Run it

```bash
npm install
npm run dev:all      # API on :4000 + Vite on :5173
```

Or run the two processes separately:

```bash
npm run server       # Express API, auto-restarts on change
npm run dev          # Vite, proxies /api to :4000
```

The database file (`server/data/uniexpert.db`) and demo content are created on
first boot. Seeding is idempotent, so restarts never duplicate rows. Delete
`server/data/` to reseed from scratch.

## Demo accounts

| Role    | Email                 | Password     |
| ------- | --------------------- | ------------ |
| Student | alex@du.ac.bd         | campus1234   |
| Mentor  | elena@du.ac.bd        | campus1234   |
| Admin   | admin@uniexpert.dev   | admin1234    |

The login card's SSO button fills the student account for you.

## Environment

Copy `.env.example` to `.env` if you want local overrides; the server scripts
load it automatically with `--env-file-if-exists` (real environment variables
take precedence).

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `SESSION_SECRET` | dev-only fallback | **Required in production**, 32+ characters. The server refuses to boot without it when `NODE_ENV=production`. |
| `NODE_ENV` | development | Set to `production` to require `SESSION_SECRET` and mark cookies `Secure`. |
| `PORT` | `4000` | API / production server port. |
| `DB_PATH` | `server/data/uniexpert.db` | SQLite file. Tests must point this at a temporary file. |
| `SEED_DEMO_DATA` | enabled | Set to `0` to skip demo seeding. |
| `SESSION_TTL_DAYS` | `7` | Session and cookie lifetime. |
| `TRUST_PROXY` | off | Set to `1` behind a trusted reverse proxy so `req.ip` is correct. |
| `LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MS` | `20` / `900000` | Login attempts per IP. |
| `REGISTER_RATE_LIMIT_MAX` / `_WINDOW_MS` | `10` / `3600000` | Registrations per IP. |
| `WRITE_RATE_LIMIT_MAX` / `_WINDOW_MS` | `60` / `60000` | Posts and mentorship requests per IP. |
| `RATE_LIMIT_DISABLED` | off | Disable limiters for automated tests only. |

## Tests

```bash
npm test             # node:test, isolated temporary database
npm run test:watch
npm run lint
npm run build
```

The suite never opens the development database: it sets `DB_PATH` to a fresh
temporary file and refuses to start if a test run has no `DB_PATH`. Each test
resets the fixture tables, so it is safe to run repeatedly.

## How the pieces fit

- **University gate** — registration only accepts academic domains
  (`.edu`, `.ac.uk`, `.edu.in`, `.ac.nz`, `.ac.bd`, `.edu.bd`). Students are verified automatically
  from their domain; mentor accounts require a headline and expertise, start as
  `pending`, and appear in the admin verification queue before they show up in
  mentor search or can receive mentorship requests.
- **Auth** — passwords are scrypt-hashed. A signed, httpOnly, SameSite=Lax
  cookie carries a session id; the matching row in the `sessions` table is
  checked on every request, so logout truly revokes the session. Sessions
  expire after seven days by default and `Remember Me` controls whether the
  cookie outlives the browser.
- **Authorisation** — the server is the source of truth: role and ownership
  checks run on every mutating endpoint, admin routes are role-gated, and
  request bodies only ever update known fields.
- **Data** — `users`, `sessions`, `posts`, `post_likes`, `requests` tables with
  foreign keys and indexes. Multi-step writes (registration + session, seed)
  run in transactions.
- **Front end** — `src/App.jsx` restores the session on load, then renders
  either `LoginPage` or `DashboardPage`. All HTTP goes through `src/lib/api.js`.

## API

| Method | Route                          | Purpose                              |
| ------ | ------------------------------ | ------------------------------------ |
| GET    | `/api/health`                  | Liveness + database check            |
| POST   | `/api/auth/register`           | Join with a campus email             |
| POST   | `/api/auth/login`              | Sign in                              |
| POST   | `/api/auth/logout`             | Revoke the current session           |
| GET    | `/api/auth/me`                 | Current user                         |
| GET    | `/api/stats`                   | Network counters                     |
| GET    | `/api/experts?q=`              | Verified mentors, searchable         |
| GET    | `/api/posts`                   | Campus feed                          |
| POST   | `/api/posts`                   | Create a post                        |
| POST   | `/api/posts/:id/like`          | Toggle like                          |
| DELETE | `/api/posts/:id`               | Delete your own post (admin: any)    |
| GET    | `/api/requests`                | Incoming + outgoing mentorship asks  |
| POST   | `/api/requests`                | Request a verified mentor            |
| PATCH  | `/api/requests/:id`            | Mentor accepts / declines            |
| GET    | `/api/admin/pending`           | Verification queue (admin only)      |
| PATCH  | `/api/admin/users/:id/approve` | Verify an account (admin only)       |

Errors are always `{ "error": "message" }`. Malformed JSON returns 400,
invalid ids 400, missing resources 404, permission failures 403, conflicts 409,
and rate limits 429 with `Retry-After`.

## Production

```bash
export NODE_ENV=production
export SESSION_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
npm run build
npm run preview      # Express serves dist/ and the API on :4000
```

The server refuses to start in production without a 32+ character
`SESSION_SECRET`. Serve it behind TLS (the app itself does not terminate TLS)
and set `TRUST_PROXY=1` only when a trusted proxy is in front.

## Known limitations

- Rate limiting is in-memory: per process, reset on restart, not shared across
  multiple instances.
- No CSRF token. `SameSite=Lax` plus JSON request bodies is the current
  mitigation; add tokens before exposing sensitive cross-site flows.
- No email delivery, password reset, or email ownership verification beyond the
  academic-domain gate.
- Sessions are revoked on logout and expire by TTL, but there is no "sign out
  everywhere" endpoint.
- No audit log, pagination, or account lockout beyond the IP rate limits.
