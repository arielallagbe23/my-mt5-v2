import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'

function formatAmount(amount, currency) {
  if (typeof amount !== 'number') return '—'
  const formatted = amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${formatted} ${currency}` : formatted
}

export function ProfilePage() {
  const { user, updateProfile } = useAuth()
  const [pseudo, setPseudo] = useState(user?.pseudo ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [status, setStatus] = useState(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    requestAndPoll({
      request: () => api.requestAccountStatus(),
      fetch: () => api.accountStatus(),
      isFresh: isFreshTs,
      isCancelled: () => cancelled,
    }).then((data) => {
      if (cancelled) return
      setStatus(data)
      setStatusLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave(event) {
    event.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      await updateProfile(pseudo)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Profil</h1>

      <div>
        <p className="text-sm text-slate-400">Email</p>
        <p className="mt-1 wrap-break-word font-medium text-white">{user.email}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${status?.online ? 'bg-green-500' : 'bg-slate-600'}`}
          />
          <span>Compte {status?.login ?? ''}</span>
        </div>
        <p className="mt-1 text-2xl font-bold text-white">
          {statusLoading
            ? 'Récupération...'
            : status?.online
              ? formatAmount(status.equity, status.currency)
              : 'VPS non connecté'}
        </p>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-slate-400">
          <span>Pseudo</span>
          <input
            type="text"
            maxLength={30}
            placeholder="Ton pseudo"
            value={pseudo}
            onChange={(event) => {
              setPseudo(event.target.value)
              setSaved(false)
            }}
            className={FIELD_INPUT}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-green-400">Pseudo enregistré.</p>}
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 self-start rounded-full bg-indigo-600 px-5 font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </form>
    </div>
  )
}
