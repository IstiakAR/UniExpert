import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import { api } from './lib/api'

function BootScreen() {
  return (
    <div className="boot">
      <span className="boot-mark">
        <GraduationCap size={30} strokeWidth={2.2} />
      </span>
      <span className="boot-spinner" aria-label="Checking your session" />
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)

  // Reuses the httpOnly session cookie so a refresh keeps you signed in.
  useEffect(() => {
    let alive = true
    api
      .me()
      .then(({ user: me }) => {
        if (alive) setUser(me)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setBooting(false)
      })
    return () => {
      alive = false
    }
  }, [])

  async function handleSignOut() {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }

  if (booting) return <BootScreen />
  if (!user) return <LoginPage onAuthenticated={setUser} />

  return (
    <DashboardPage key={user.id} user={user} onSignOut={handleSignOut} />
  )
}
