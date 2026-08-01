import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE } from '../lib/layout'

export function AccountsPage() {
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .accountStatus()
      .then((data) => setAccounts(data.accounts ?? {}))
      .catch(() => setError('Impossible de charger les comptes'))
      .finally(() => setLoading(false))
  }, [])

  const accountEntries = accounts ? Object.entries(accounts) : []

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Mes comptes</h1>

      {loading && <p className="text-sm text-slate-400">Chargement...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && accountEntries.length === 0 && (
        <p className="text-sm text-slate-400">Aucun compte configuré.</p>
      )}

      <ul className="flex flex-col gap-2">
        {accountEntries.map(([login, info]) => (
          <li key={login} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="font-semibold text-white">Compte {login}</p>
            <p className="text-sm text-slate-400">
              Taille : {typeof info.account_size === 'number' ? info.account_size.toLocaleString('fr-FR') : '—'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
