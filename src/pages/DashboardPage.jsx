import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  GraduationCap,
  Heart,
  Inbox,
  LayoutGrid,
  LogOut,
  MapPin,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import './DashboardPage.css'

const TAGS = ['General', 'Research', 'Design', 'Careers', 'Study Group', 'Events']

const AVATAR_PAIRS = [
  ['#a855f7', '#6366f1'],
  ['#f59e0b', '#f43f5e'],
  ['#14b8a6', '#0ea5e9'],
  ['#ec4899', '#8b5cf6'],
  ['#22c55e', '#0d9488'],
]

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function avatarStyle(name = '') {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997
  const [from, to] = AVATAR_PAIRS[hash % AVATAR_PAIRS.length]
  return { background: `linear-gradient(135deg, ${from}, ${to})` }
}

function timeAgo(value) {
  if (!value) return ''
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const statusChip = {
  pending: 'dash-chip dash-chip--gold',
  accepted: 'dash-chip dash-chip--green',
  declined: 'dash-chip dash-chip--red',
}

function Avatar({ name, size = 'md' }) {
  return (
    <span
      className={`dash-avatar dash-avatar--${size}`}
      style={avatarStyle(name)}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="dash-stat">
      <span className="dash-stat-icon">
        <Icon size={17} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

function MentorCard({ expert, user, onRequest, index }) {
  const canRequest = user.role === 'student'
  const skills = (expert.expertise || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)

  return (
    <article className="dash-mentor dash-fade" style={{ '--i': index }}>
      <div className="dash-mentor-top">
        <Avatar name={expert.name} size="lg" />
        <div className="dash-mentor-id">
          <strong>{expert.name}</strong>
          <span>
            <MapPin size={12} />
            {expert.campus}
          </span>
        </div>
      </div>

      <p className="dash-mentor-headline">{expert.headline}</p>

      {skills.length > 0 && (
        <div className="dash-tags">
          {skills.map((skill) => (
            <span key={skill} className="dash-tag">
              {skill}
            </span>
          ))}
        </div>
      )}

      <div className="dash-mentor-foot">
        {!canRequest ? null : expert.openRequest ? (
          <span className="dash-chip dash-chip--gold">
            <Clock size={13} />
            Request pending
          </span>
        ) : (
          <button
            type="button"
            className="dash-btn dash-btn--sm"
            onClick={() => onRequest(expert)}
          >
            Request mentorship
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </article>
  )
}

function PostCard({ post, onLike }) {
  return (
    <article className="dash-post dash-fade">
      <header className="dash-post-head">
        <Avatar name={post.author.name} size="sm" />
        <div className="dash-post-id">
          <strong>{post.author.name}</strong>
          <span>
            {post.author.campus} · {timeAgo(post.createdAt)}
          </span>
        </div>
        {post.tag && <span className="dash-tag">{post.tag}</span>}
      </header>
      <p className="dash-post-body">{post.body}</p>
      <footer className="dash-post-foot">
        <button
          type="button"
          className={`dash-like${post.liked ? ' is-liked' : ''}`}
          onClick={() => onLike(post.id)}
          aria-pressed={post.liked}
        >
          <Heart size={15} fill={post.liked ? 'currentColor' : 'none'} />
          {post.likes}
        </button>
      </footer>
    </article>
  )
}

function Composer({ user, onCreate }) {
  const [body, setBody] = useState('')
  const [tag, setTag] = useState('General')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (busy || body.trim().length < 3) return
    setBusy(true)
    setError('')
    try {
      await onCreate(body.trim(), tag)
      setBody('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="dash-composer" onSubmit={submit}>
      <div className="dash-composer-head">
        <Avatar name={user.name} size="sm" />
        <span>
          Share something with <strong>{user.campus}</strong>
        </span>
      </div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Ask a question, share an opportunity, start a study group…"
        maxLength={600}
        rows={3}
      />
      <div className="dash-composer-foot">
        <select
          className="dash-select"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          aria-label="Post topic"
        >
          {TAGS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="dash-count">{body.length}/600</span>
        <button
          type="submit"
          className="dash-btn dash-btn--sm"
          disabled={busy || body.trim().length < 3}
        >
          <Send size={14} />
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && <p className="dash-inline-error">{error}</p>}
    </form>
  )
}

function RequestsView({ requests, user, onRespond }) {
  const list = user.role === 'student' ? requests.outgoing : requests.incoming
  const heading = user.role === 'student' ? 'Requests you sent' : 'Requests for you'

  return (
    <div className="dash-stack">
      <div className="dash-head">
        <div>
          <h2>Mentorship requests</h2>
          <p>
            {user.role === 'student'
              ? 'Mentors usually reply within a couple of days.'
              : 'Accept the ones you have space for — quality beats volume.'}
          </p>
        </div>
      </div>

      <section className="dash-panel">
        <h3 className="dash-panel-title">{heading}</h3>
        {list.length === 0 ? (
          <div className="dash-empty">
            <Inbox size={22} />
            <p>No requests yet.</p>
          </div>
        ) : (
          <ul className="dash-req-list">
            {list.map((request) => (
              <li key={request.id} className="dash-req">
                <Avatar
                  name={
                    user.role === 'student'
                      ? request.expert.name
                      : request.student.name
                  }
                  size="sm"
                />
                <div className="dash-req-body">
                  <div className="dash-req-top">
                    <strong>
                      {user.role === 'student'
                        ? request.expert.name
                        : request.student.name}
                    </strong>
                    <span className={statusChip[request.status]}>
                      {request.status}
                    </span>
                  </div>
                  <p>{request.message}</p>
                  <span className="dash-req-meta">
                    {timeAgo(request.createdAt)}
                  </span>
                </div>
                {user.role !== 'student' && request.status === 'pending' && (
                  <div className="dash-req-actions">
                    <button
                      type="button"
                      className="dash-btn dash-btn--sm"
                      onClick={() => onRespond(request.id, 'accepted')}
                    >
                      <Check size={14} />
                      Accept
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--ghost dash-btn--sm"
                      onClick={() => onRespond(request.id, 'declined')}
                    >
                      <X size={14} />
                      Decline
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function VerificationView({ pending, onApprove }) {
  return (
    <div className="dash-stack">
      <div className="dash-head">
        <div>
          <h2>Verification queue</h2>
          <p>Confirm credentials to keep the network university-exclusive.</p>
        </div>
      </div>

      <section className="dash-panel">
        {pending.length === 0 ? (
          <div className="dash-empty">
            <BadgeCheck size={22} />
            <p>Nothing waiting. Every account is verified.</p>
          </div>
        ) : (
          <ul className="dash-req-list">
            {pending.map((person) => (
              <li key={person.id} className="dash-req">
                <Avatar name={person.name} size="sm" />
                <div className="dash-req-body">
                  <div className="dash-req-top">
                    <strong>{person.name}</strong>
                    <span className="dash-chip">{person.role}</span>
                  </div>
                  <p>{person.headline || 'Mentor application'}</p>
                  <span className="dash-req-meta">
                    {person.email} · {person.campus}
                  </span>
                </div>
                <button
                  type="button"
                  className="dash-btn dash-btn--sm"
                  onClick={() => onApprove(person.id)}
                >
                  <ShieldCheck size={14} />
                  Verify
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Overview({
  user,
  stats,
  experts,
  posts,
  requests,
  onTab,
  onRequest,
  onLike,
}) {
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user.name.split(' ')[0]

  const recommended = [...experts]
    .sort(
      (a, b) =>
        Number(b.campus === user.campus) - Number(a.campus === user.campus),
    )
    .slice(0, 3)

  const pendingIncoming = requests.incoming.filter(
    (request) => request.status === 'pending',
  )

  return (
    <div className="dash-stack">
      <section className="dash-hero">
        <div>
          <p className="dash-eyebrow">
            <Sparkles size={14} />
            {user.campus}
          </p>
          <h1>
            {greeting}, {firstName}.
          </h1>
          <p className="dash-hero-sub">
            {user.role === 'expert'
              ? 'Your mentees are waiting — keep an eye on new requests.'
              : 'Find a mentor, join the campus feed, and make this term count.'}
          </p>
        </div>
        <button
          type="button"
          className="dash-btn"
          onClick={() => onTab('mentors')}
        >
          Find a mentor
          <ArrowRight size={16} />
        </button>
      </section>

      <div className="dash-stats">
        <Stat icon={Users} label="Verified mentors" value={stats?.experts ?? '—'} />
        <Stat icon={GraduationCap} label="Students" value={stats?.students ?? '—'} />
        <Stat icon={Inbox} label="Mentorships" value={stats?.mentorships ?? '—'} />
        <Stat icon={MapPin} label="Campuses" value={stats?.campuses ?? '—'} />
      </div>

      {user.role !== 'student' && pendingIncoming.length > 0 && (
        <section className="dash-panel dash-panel--gold">
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">
              <Clock size={16} /> {pendingIncoming.length} request
              {pendingIncoming.length > 1 ? 's' : ''} waiting
            </h3>
            <button
              type="button"
              className="dash-link"
              onClick={() => onTab('requests')}
            >
              Review
            </button>
          </div>
          <p className="dash-panel-sub">
            {pendingIncoming[0].student.name} — “{pendingIncoming[0].message}”
          </p>
        </section>
      )}

      <div className="dash-split">
        <section>
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Recommended mentors</h3>
            <button
              type="button"
              className="dash-link"
              onClick={() => onTab('mentors')}
            >
              See all
            </button>
          </div>
          <div className="dash-mentor-grid dash-mentor-grid--tight">
            {recommended.map((expert, index) => (
              <MentorCard
                key={expert.id}
                expert={expert}
                user={user}
                onRequest={onRequest}
                index={index}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="dash-panel-head">
            <h3 className="dash-panel-title">Campus feed</h3>
            <button
              type="button"
              className="dash-link"
              onClick={() => onTab('feed')}
            >
              Open feed
            </button>
          </div>
          <div className="dash-posts">
            {posts.slice(0, 2).map((post) => (
              <PostCard key={post.id} post={post} onLike={onLike} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function RequestModal({ expert, onClose, onSend }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSend(expert, message)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="dash-modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="dash-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-title"
      >
        <div className="dash-modal-head">
          <div>
            <h2 id="request-title">Request mentorship</h2>
            <p>{expert.name} · {expert.campus}</p>
          </div>
          <button
            type="button"
            className="dash-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <label className="dash-modal-label" htmlFor="request-message">
          What do you need help with?
        </label>
        <textarea
          id="request-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Two or three sentences about your goal and where you are stuck."
          rows={5}
          minLength={10}
          maxLength={500}
          required
          autoFocus
        />
        {error && <p className="dash-inline-error">{error}</p>}

        <div className="dash-modal-foot">
          <button
            type="button"
            className="dash-btn dash-btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="dash-btn" disabled={busy}>
            <Send size={15} />
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function DashboardPage({ user, onSignOut }) {
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [experts, setExperts] = useState([])
  const [posts, setPosts] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [pending, setPending] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestTarget, setRequestTarget] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.stats(), api.experts(), api.posts(), api.requests()])
      .then(([statsData, expertsData, postsData, requestsData]) => {
        if (!alive) return
        setStats(statsData)
        setExperts(expertsData.experts)
        setPosts(postsData.posts)
        setRequests(requestsData)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError(err.message)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (user.role !== 'admin') return undefined
    let alive = true
    api
      .pendingUsers()
      .then(({ users }) => {
        if (alive) setPending(users)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user.role])

  const term = query.trim().toLowerCase()

  const visibleExperts = term
    ? experts.filter((expert) =>
        [expert.name, expert.campus, expert.headline, expert.expertise]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(term)),
      )
    : experts

  const visiblePosts = term
    ? posts.filter((post) =>
        [post.body, post.author.name, post.author.campus, post.tag]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(term)),
      )
    : posts

  const pendingIncoming = requests.incoming.filter(
    (request) => request.status === 'pending',
  ).length

  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'mentors', label: 'Mentors', icon: Users },
    { id: 'feed', label: 'Campus feed', icon: MessageSquare },
    { id: 'requests', label: 'Requests', icon: Inbox, badge: pendingIncoming },
  ]
  if (user.role === 'admin') {
    navItems.push({
      id: 'verification',
      label: 'Verification',
      icon: ShieldCheck,
      badge: pending.length,
    })
  }

  const searchPlaceholder =
    tab === 'mentors'
      ? 'Search mentors, skills, campuses'
      : tab === 'feed'
        ? 'Search posts'
        : 'Search the campus network'

  async function handleCreatePost(body, tag) {
    const data = await api.createPost(body, tag)
    setPosts(data.posts)
  }

  async function handleLike(id) {
    try {
      const data = await api.likePost(id)
      setPosts(data.posts)
    } catch (err) {
      setNotice(err.message)
    }
  }

  async function handleSendRequest(expert, message) {
    const { request } = await api.createRequest(expert.id, message)
    setRequests((prev) => ({
      ...prev,
      outgoing: [request, ...prev.outgoing],
    }))
    setExperts((prev) =>
      prev.map((item) =>
        item.id === expert.id
          ? { ...item, openRequest: { id: request.id, status: 'pending' } }
          : item,
      ),
    )
    setRequestTarget(null)
    setNotice(`Request sent to ${expert.name}.`)
  }

  async function handleRespond(id, status) {
    try {
      const { request } = await api.respondToRequest(id, status)
      setRequests((prev) => ({
        ...prev,
        incoming: prev.incoming.map((item) =>
          item.id === id ? request : item,
        ),
      }))
      setNotice(
        status === 'accepted'
          ? `Accepted — ${request.student.name} can now reach you.`
          : 'Request declined.',
      )
    } catch (err) {
      setNotice(err.message)
    }
  }

  async function handleApprove(id) {
    try {
      await api.approveUser(id)
      setPending((prev) => prev.filter((person) => person.id !== id))
      setStats((prev) =>
        prev
          ? {
              ...prev,
              pending: Math.max(0, prev.pending - 1),
              experts: prev.experts + 1,
            }
          : prev,
      )
      setNotice('Account verified and added to the network.')
    } catch (err) {
      setNotice(err.message)
    }
  }

  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="dash-brand">
          <span className="dash-brand-mark">
            <GraduationCap size={22} strokeWidth={2.3} />
          </span>
          <span className="dash-brand-name">
            Uni<span>Expert</span>
          </span>
        </div>

        <nav className="dash-nav" aria-label="Dashboard">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`dash-nav-item${tab === item.id ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.badge > 0 && (
                <span className="dash-nav-badge">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="dash-side-foot">
          <div className="dash-me">
            <Avatar name={user.name} size="sm" />
            <div className="dash-me-text">
              <strong>{user.name}</strong>
              <span>{user.campus}</span>
            </div>
          </div>
          <button
            type="button"
            className="dash-signout"
            onClick={onSignOut}
            title="Sign out"
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-top">
          <label className="dash-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <span
            className={`dash-verify${
              user.status === 'verified' ? ' is-ok' : ' is-pending'
            }`}
          >
            {user.status === 'verified' ? (
              <BadgeCheck size={15} />
            ) : (
              <Clock size={15} />
            )}
            {user.status === 'verified'
              ? 'Verified campus account'
              : 'Verification pending'}
          </span>
        </header>

        {error && <div className="dash-alert">{error}</div>}
        {user.role === 'expert' && user.status === 'pending' && (
          <div className="dash-alert dash-alert--gold">
            Your mentor profile is in review — the campus team confirms
            credentials before it appears in mentor search.
          </div>
        )}

        {loading ? (
          <div className="dash-loading">
            <span className="dash-spinner" />
            Loading your campus…
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <Overview
                user={user}
                stats={stats}
                experts={experts}
                posts={posts}
                requests={requests}
                onTab={setTab}
                onRequest={setRequestTarget}
                onLike={handleLike}
              />
            )}

            {tab === 'mentors' && (
              <div className="dash-stack">
                <div className="dash-head">
                  <div>
                    <h2>Mentors on campus</h2>
                    <p>
                      {visibleExperts.length} verified mentor
                      {visibleExperts.length === 1 ? '' : 's'} ready to help.
                    </p>
                  </div>
                </div>
                {visibleExperts.length === 0 ? (
                  <div className="dash-empty dash-empty--boxed">
                    <Users size={22} />
                    <p>No mentors match “{query}”.</p>
                  </div>
                ) : (
                  <div className="dash-mentor-grid">
                    {visibleExperts.map((expert, index) => (
                      <MentorCard
                        key={expert.id}
                        expert={expert}
                        user={user}
                        onRequest={setRequestTarget}
                        index={index}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'feed' && (
              <div className="dash-stack">
                <div className="dash-head">
                  <div>
                    <h2>Campus feed</h2>
                    <p>Questions, opportunities, and study groups.</p>
                  </div>
                </div>
                <Composer user={user} onCreate={handleCreatePost} />
                {visiblePosts.length === 0 ? (
                  <div className="dash-empty dash-empty--boxed">
                    <MessageSquare size={22} />
                    <p>Nothing here yet — be the first to post.</p>
                  </div>
                ) : (
                  <div className="dash-posts">
                    {visiblePosts.map((post) => (
                      <PostCard key={post.id} post={post} onLike={handleLike} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'requests' && (
              <RequestsView
                requests={requests}
                user={user}
                onRespond={handleRespond}
              />
            )}

            {tab === 'verification' && user.role === 'admin' && (
              <VerificationView pending={pending} onApprove={handleApprove} />
            )}
          </>
        )}
      </main>

      {notice && (
        <div className="dash-toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {requestTarget && (
        <RequestModal
          expert={requestTarget}
          onClose={() => setRequestTarget(null)}
          onSend={handleSendRequest}
        />
      )}
    </div>
  )
}
