import { useState } from 'react'
import { useAuth } from '../context/useAuth'

export function Navbar({ page, onNavigate }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) return null

  function go(target) {
    onNavigate(target)
    setOpen(false)
  }

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/80 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between">
        <button type="button" onClick={() => go('home')} className="text-lg font-bold text-white">
          mymt5
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setOpen((value) => !value)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {open && (
            <>
              <button
                type="button"
                aria-label="Fermer le menu"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/40">
                {[
                  { key: 'profile', label: 'Profil' },
                  { key: 'accounts', label: 'Mes comptes' },
                  { key: 'tasks', label: 'Gestion tâche' },
                  { key: 'tasksList', label: 'Liste des tâches' },
                  { key: 'setOrder', label: 'Ordre manuel' },
                  { key: 'journal', label: 'Journal' },
                  { key: 'settings', label: 'Paramètres' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => go(item.key)}
                    className={`min-h-11 w-full rounded-xl px-3 text-left text-sm font-semibold hover:bg-white/10 ${
                      page === item.key ? 'text-indigo-400' : 'text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={logout}
                  className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-semibold text-white hover:bg-white/10"
                >
                  Se déconnecter
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
