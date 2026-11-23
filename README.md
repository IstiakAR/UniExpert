# UniExpert

University-exclusive mentorship network: React + Vite front end, Express API,
and a relational SQLite database (Node's built-in `node:sqlite`) — no native
build step and no external service to configure.

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
first boot. Delete `server/data/` to reseed from scratch.

## Demo accounts

| Role    | Email                 | Password     |
| ------- | --------------------- | ------------ |
| Student | alex@stanford.edu     | campus1234   |
| Mentor  | elena@stanford.edu    | campus1234   |
| Admin   | admin@uniexpert.dev   | admin1234    |

The login card's SSO button fills the student account for you.

## How the pieces fit

- **University gate** — registration only accepts academic domains
  (`.edu`, `.ac.uk`, `.edu.in`, `.ac.nz`). Students are verified automatically
  from their domain; mentor accounts start as `pending` and appear in the
  admin verification queue before they show up in mentor search.
- **Auth** — passwords are scrypt-hashed; the session is an HMAC-signed,
  httpOnly, SameSite=Lax cookie valid for 7 days. Set `SESSION_SECRET` in
  production.
- **Data** — `users`, `posts`, `post_likes`, `requests` tables with foreign keys.
  Seed data lives in `server/db.js`.
- **Front end** — `src/App.jsx` restores the session on load, then renders
  either `LoginPage` or `DashboardPage`. All HTTP goes through `src/lib/api.js`.

## API

| Method | Route                          | Purpose                              |
| ------ | ------------------------------ | ------------------------------------ |
| POST   | `/api/auth/register`           | Join with a campus email             |
| POST   | `/api/auth/login`              | Sign in                              |
| POST   | `/api/auth/logout`             | Clear session                        |
| GET    | `/api/auth/me`                 | Current user                         |
| GET    | `/api/stats`                   | Network counters                     |
| GET    | `/api/experts?q=`              | Verified mentors, searchable         |
| GET    | `/api/posts`                   | Campus feed                          |
| POST   | `/api/posts`                   | Create a post                        |
| POST   | `/api/posts/:id/like`          | Toggle like                          |
| DELETE | `/api/posts/:id`               | Delete your own post                 |
| GET    | `/api/requests`                | Incoming + outgoing mentorship asks  |
| POST   | `/api/requests`                | Request mentorship                   |
| PATCH  | `/api/requests/:id`            | Mentor accepts / declines            |
| GET    | `/api/admin/pending`           | Verification queue (admin only)      |
| PATCH  | `/api/admin/users/:id/approve` | Verify an account (admin only)       |

## Production

```bash
npm run build
npm run preview      # Express serves dist/ and the API on :4000
```
