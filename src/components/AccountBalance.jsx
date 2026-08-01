import { useEffect, useState } from 'react'
import { api } from '../lib/api'

function formatAmount(amount, currency) {
  if (typeof amount !== 'number') return '—'
  const formatted = amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${formatted} ${currency}` : formatted
}

const refreshButton =
  'ml-auto min-h-8 rounded-full bg-indigo-100 px-3 text-sm font-semibold text-indigo-600 disabled:opacity-60'

export function AccountBalance() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load(isRefresh) {
    if (isRefresh) setRefreshing(true)
    try {
      const data = await api.accountStatus()
      setStatus(data)
      setError('')
    } catch {
      setError('VPS non connecté')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load(false)
  }, [])

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-6 py-5 text-sm text-gray-500">
        Chargement du solde...
      </div>
    )
  }

  if (error || !status?.online) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-6 py-5 text-sm text-gray-500">
        <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
        VPS non connecté
        <button className={refreshButton} type="button" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? '...' : 'Réessayer'}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-6 py-5">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="h-2 w-2 shrink-0 rounded-full bg-green-600" />
        <span>Compte {status.login ?? ''}</span>
        <button className={refreshButton} type="button" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? '...' : 'Actualiser'}
        </button>
      </div>
      <p className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
        {formatAmount(status.equity, status.currency)}
      </p>
    </div>
  )
}
