import { useState } from 'react'
import { useAuth } from './context/useAuth'
import { AuthPage } from './pages/AuthPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { HomePage } from './pages/HomePage'
import { ProfilePage } from './pages/ProfilePage'
import { AccountsPage } from './pages/AccountsPage'
import { TasksPage } from './pages/TasksPage'
import { TasksListPage } from './pages/TasksListPage'
import { Navbar } from './components/Navbar'
import { SAFE_AREA_SCREEN } from './lib/layout'

function App() {
  const { user, loading } = useAuth()
  const [page, setPage] = useState('home')

  if (window.location.pathname === '/reset-password') {
    const token = new URLSearchParams(window.location.search).get('token')
    if (token) return <ResetPasswordPage token={token} />
  }

  if (loading) {
    return (
      <main className={SAFE_AREA_SCREEN}>
        <p className="text-slate-400">Chargement...</p>
      </main>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-b from-slate-950 via-slate-900 to-slate-950">
      <Navbar page={page} onNavigate={setPage} />
      <main className="flex-1 pt-6 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))]">
        {page === 'home' && <HomePage />}
        {page === 'profile' && <ProfilePage />}
        {page === 'accounts' && <AccountsPage />}
        {page === 'tasks' && <TasksPage />}
        {page === 'tasksList' && <TasksListPage />}
      </main>
    </div>
  )
}

export default App
