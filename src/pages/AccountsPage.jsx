import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE } from '../lib/layout'

function formatAmount(amount, currency) {
  if (typeof amount !== 'number') return '—'
  const formatted = amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${formatted} ${currency}` : formatted
}

const VPS_LABELS = { main: 'Compte principal', account2: 'Compte suppléant' }

export function AccountsPage() {
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .allAccountsStatus()
      .then(setAccounts)
      .catch(() => setError('Impossible de charger les comptes'))
      .finally(() => setLoading(false))
  }, [])

  const entries = accounts ? Object.entries(accounts) : []

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Mes comptes</h1>

      {loading && <p className="text-sm text-slate-400">Chargement...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-slate-400">Aucun compte configuré.</p>
      )}

      <ul className="flex flex-col gap-2">
        {entries.map(([vpsId, info]) => (
          <li key={vpsId} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className={`h-2 w-2 shrink-0 rounded-full ${info.online ? 'bg-green-500' : 'bg-slate-600'}`} />
              <span>{VPS_LABELS[vpsId] ?? vpsId}</span>
            </div>
            <p className="mt-1 font-semibold text-white">Compte {info.login ?? '—'}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
              <span>Équité : {formatAmount(info.equity, info.currency)}</span>
              <span>
                Taille : {typeof info.accountSize === 'number' ? info.accountSize.toLocaleString('fr-FR') : '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
