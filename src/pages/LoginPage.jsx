import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Backpack,
  Check,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Mail,
  User,
} from 'lucide-react'
import CampusIllustration from '../components/CampusIllustration'
import { api } from '../lib/api'
import './LoginPage.css'

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

function campusFromEmail(value) {
  if (!value.includes('@')) return null
  const domain = value.split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  if (KNOWN_CAMPUSES[domain]) return `${KNOWN_CAMPUSES[domain]} Campus`
  if (
    domain.endsWith('.edu') ||
    domain.endsWith('.ac.uk') ||
    domain.endsWith('.ac.bd') ||
    domain.endsWith('.edu.bd')
  ) {
    return `${domain.split('.')[0].toUpperCase()} Student`
  }
  return null
}

const PROOF_AVATARS = [
  { initials: 'AK', background: 'linear-gradient(135deg, #a855f7, #6366f1)' },
  { initials: 'MJ', background: 'linear-gradient(135deg, #f59e0b, #f43f5e)' },
  { initials: 'SR', background: 'linear-gradient(135deg, #14b8a6, #0ea5e9)' },
  { initials: 'TW', background: 'linear-gradient(135deg, #ec4899, #8b5cf6)' },
]

// Counts up once on mount, easing out. Static for reduced-motion users.
function CountUp({ to, suffix = '' }) {
  const prefersReduced = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  const [value, setValue] = useState(prefersReduced ? to : 0)

  useEffect(() => {
    if (prefersReduced) return undefined

    let frame = 0
    const start = performance.now()
    const duration = 1400

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(to * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, prefersReduced])

  return (
    <>
      {value}
      {suffix}
    </>
  )
}

export default function LoginPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('student')
  const [headline, setHeadline] = useState('')
  const [expertise, setExpertise] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)

  const campus = campusFromEmail(email)
  const isJoin = mode === 'register'

  function switchMode(next) {
    setMode(next)
    setError('')
    setSignedIn(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy || signedIn) return

    setError('')
    setBusy(true)

    try {
      const data = isJoin
        ? await api.register({
            name: name.trim(),
            email: email.trim(),
            password,
            role,
            headline: headline.trim(),
            expertise: expertise.trim(),
          })
        : await api.login(email.trim(), password, remember)

      setBusy(false)
      setSignedIn(true)
      window.setTimeout(() => onAuthenticated(data.user), 750)
    } catch (err) {
      setBusy(false)
      setError(err.message)
    }
  }

  // Demo shortcut: fills the seeded University of Dhaka account.
  function handleSso() {
    if (isJoin) switchMode('login')
    setEmail('alex@du.ac.bd')
    setPassword('campus1234')
    setError('')
  }

  // Soft glow that tracks the cursor across the glass card.
  function handlePointerMove(event) {
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    panel.style.setProperty('--mx', `${event.clientX - rect.left}px`)
    panel.style.setProperty('--my', `${event.clientY - rect.top}px`)
  }

  return (
    <div className="login-page">
      <span className="glow glow-purple" aria-hidden="true" />
      <span className="glow glow-amber" aria-hidden="true" />
      <span className="glow glow-sky" aria-hidden="true" />

      <header className="topbar">
        <div className="brand reveal" style={{ '--i': 0 }}>
          <span className="brand-mark">
            <GraduationCap size={26} strokeWidth={2.2} />
          </span>
          <span className="brand-name">
            Uni<span className="brand-name-accent">Expert</span>
          </span>
          <span className="brand-badge">Campus</span>
        </div>
      </header>

      <main className="layout">
        <section className="showcase">
          <div className="showcase-art-wrap reveal" style={{ '--i': 1 }}>
            <CampusIllustration />
          </div>

          <p className="showcase-copy reveal" style={{ '--i': 2 }}>
            Find mentors, alumni, and study partners from your campus.
          </p>

          <div className="showcase-proof reveal" style={{ '--i': 3 }}>
            <div className="avatar-stack" aria-hidden="true">
              {PROOF_AVATARS.map((avatar) => (
                <span
                  key={avatar.initials}
                  className="avatar"
                  style={{ background: avatar.background }}
                >
                  {avatar.initials}
                </span>
              ))}
              <span className="avatar avatar-more">+496</span>
            </div>
            <p className="proof-text">
              <strong>
                <CountUp to={500} suffix="+" />
              </strong>{' '}
              alumni mentors across{' '}
              <strong>
                <CountUp to={12} />
              </strong>{' '}
              universities
            </p>
          </div>
        </section>

        <section
          className="panel reveal"
          style={{ '--i': 3 }}
          ref={panelRef}
          onPointerMove={handlePointerMove}
        >
          <div className="panel-head reveal" style={{ '--i': 4 }}>
            <h1 className="panel-title">
              {isJoin ? 'Join your campus' : 'Welcome back to campus'}
            </h1>
            <p className="panel-sub">
              {isJoin
                ? 'University email required — that is what keeps this network exclusive.'
                : 'Sign in with your university email to continue.'}
            </p>
          </div>

          <button
            type="button"
            className="sso reveal"
            style={{ '--i': 5 }}
            onClick={handleSso}
          >
            <GraduationCap size={18} />
            <span>
              {isJoin ? 'Use a demo campus account' : 'Sign in with University SSO'}
            </span>
            <ArrowRight size={18} className="sso-arrow" />
          </button>

          <div className="divider reveal" style={{ '--i': 6 }}>
            <span>{isJoin ? 'or create with email' : 'or with email'}</span>
          </div>

          <form onSubmit={handleSubmit}>
            {isJoin && (
              <div className="field reveal" style={{ '--i': 7 }}>
                <div className="label-row">
                  <label htmlFor="join-name">
                    <User size={18} />
                    Full Name
                  </label>
                </div>
                <div className="input-shell">
                  <input
                    id="join-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Alex Rivera"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <div className="field reveal" style={{ '--i': 7 }}>
              <div className="label-row">
                <label htmlFor="login-email">
                  <Mail size={18} />
                  Campus Email
                </label>
                {campus && (
                  <span className="campus-pill">
                    <Backpack size={14} />
                    {campus}
                  </span>
                )}
              </div>
              <div className="input-shell">
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@university.edu"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <span className="edu-tag">.edu</span>
              </div>
            </div>

            <div className="field reveal" style={{ '--i': 8 }}>
              <div className="label-row">
                <label htmlFor="login-password">
                  <KeyRound size={18} />
                  Password
                </label>
                {!isJoin && (
                  <a
                    className="soft-link"
                    href="#forgot"
                    onClick={(event) => event.preventDefault()}
                  >
                    Forgot password?
                  </a>
                )}
              </div>
              <div className="input-shell">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isJoin ? 'new-password' : 'current-password'}
                  placeholder={isJoin ? 'At least 8 characters' : 'Enter your password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={isJoin ? 8 : undefined}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span
                    key={showPassword ? 'shown' : 'hidden'}
                    className="pw-icon"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </span>
                </button>
              </div>
            </div>

            {isJoin && (
              <>
                <div className="field reveal" style={{ '--i': 9 }}>
                  <span className="field-label">I am joining as</span>
                  <div className="segmented">
                    <button
                      type="button"
                      className={role === 'student' ? 'is-active' : undefined}
                      onClick={() => setRole('student')}
                    >
                      Student
                    </button>
                    <button
                      type="button"
                      className={role === 'expert' ? 'is-active' : undefined}
                      onClick={() => setRole('expert')}
                    >
                      Mentor
                    </button>
                  </div>
                </div>

                {role === 'expert' && (
                  <div className="field reveal" style={{ '--i': 10 }}>
                    <div className="label-row">
                      <label htmlFor="join-headline">Mentor Headline</label>
                    </div>
                    <div className="input-shell">
                      <input
                        id="join-headline"
                        type="text"
                        placeholder="ML researcher · Human-centered AI"
                        value={headline}
                        onChange={(event) => setHeadline(event.target.value)}
                        required
                      />
                    </div>
                    <div className="label-row label-row--spaced">
                      <label htmlFor="join-expertise">Areas of Expertise</label>
                    </div>
                    <div className="input-shell">
                      <input
                        id="join-expertise"
                        type="text"
                        placeholder="Machine Learning, Python, Research"
                        value={expertise}
                        onChange={(event) => setExpertise(event.target.value)}
                        required
                      />
                    </div>
                    <p className="field-hint">
                      Mentor profiles are verified by the campus team before they
                      appear in the network.
                    </p>
                  </div>
                )}
              </>
            )}

            {!isJoin && (
              <label className="remember reveal" style={{ '--i': 9 }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span className="remember-box" aria-hidden="true">
                  <Check size={14} strokeWidth={3} />
                </span>
                Remember me on this device
              </label>
            )}

            {error && (
              <p className="form-error" role="alert" key={error}>
                {error}
              </p>
            )}

            <button
              className={`submit reveal${signedIn ? ' is-done' : ''}`}
              style={{ '--i': 10 }}
              type="submit"
              disabled={busy || signedIn}
              aria-busy={busy}
            >
              <span>
                {signedIn
                  ? isJoin
                    ? 'Welcome Aboard'
                    : 'Signed In'
                  : busy
                    ? isJoin
                      ? 'Creating Account…'
                      : 'Signing You In…'
                    : isJoin
                      ? 'Create Account'
                      : 'Sign In'}
              </span>
              {busy ? (
                <span className="spinner" aria-hidden="true" />
              ) : signedIn ? (
                <Check size={18} className="submit-check" />
              ) : (
                <ArrowRight size={18} className="submit-arrow" />
              )}
            </button>

            {signedIn && (
              <p className="notice" role="status">
                Taking you to your campus dashboard…
              </p>
            )}
          </form>

          <div className="panel-foot reveal" style={{ '--i': 11 }}>
            <p className="signup">
              {isJoin ? 'Already on campus?' : 'Need an account?'}{' '}
              <button
                type="button"
                className="signup-link"
                onClick={() => switchMode(isJoin ? 'login' : 'register')}
              >
                {isJoin ? 'Sign in instead' : 'Join your campus'}
              </button>
            </p>
            {!isJoin && (
              <p className="demo-hint">
                Demo login:{' '}
                <button type="button" onClick={handleSso}>
                  alex@du.ac.bd
                </button>{' '}
                · campus1234
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="footer reveal" style={{ '--i': 12 }}>
        <div className="footer-links">
          <span>© 2025 UniExpert</span>
          <span className="footer-sep">•</span>
          <a href="#privacy" onClick={(event) => event.preventDefault()}>
            Privacy
          </a>
          <span className="footer-sep">•</span>
          <a href="#terms" onClick={(event) => event.preventDefault()}>
            Terms
          </a>
        </div>
      </footer>
    </div>
  )
}
