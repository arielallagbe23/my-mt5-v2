import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'
import { isPushSupported, getPushSubscription, enablePush, disablePush } from '../lib/push'

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

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushError, setPushError] = useState('')

  const [alertSettings, setAlertSettings] = useState({ h1: true, h4: true })
  const [alertError, setAlertError] = useState('')

  useEffect(() => {
    if (!isPushSupported()) return
    getPushSubscription().then((sub) => setPushEnabled(Boolean(sub)))
  }, [])

  useEffect(() => {
    api.alertSettings().then(setAlertSettings).catch(() => {})
  }, [])

  async function toggleAlertTimeframe(key) {
    const next = { ...alertSettings, [key]: !alertSettings[key] }
    setAlertSettings(next) // optimiste : on remonte tout de suite, on annule si ça échoue
    setAlertError('')
    try {
      await api.updateAlertSettings(next)
    } catch (err) {
      setAlertSettings(alertSettings)
      setAlertError(err.message)
    }
  }

  async function togglePush() {
    setPushError('')
    setPushLoading(true)
    try {
      if (pushEnabled) {
        await disablePush()
        setPushEnabled(false)
      } else {
        await enablePush()
        setPushEnabled(true)
      }
    } catch (err) {
      setPushError(err.message)
    } finally {
      setPushLoading(false)
    }
  }

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

      {isPushSupported() && (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-sm font-semibold text-white">Notifications</p>
          <p className="mt-1 text-sm text-slate-400">
            Reçois une notification sur ce téléphone quand une tâche s'exécute.
          </p>
          {pushError && <p className="mt-2 text-sm text-red-400">{pushError}</p>}
          <button
            type="button"
            onClick={togglePush}
            disabled={pushLoading}
            className={`mt-3 min-h-10 rounded-full px-5 text-sm font-semibold disabled:opacity-60 ${
              pushEnabled ? 'bg-white/10 text-slate-300' : 'bg-indigo-600 text-white'
            }`}
          >
            {pushLoading ? '...' : pushEnabled ? 'Désactiver les notifications' : 'Activer les notifications'}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        <p className="text-sm font-semibold text-white">Alertes de clôture</p>
        <p className="mt-1 text-sm text-slate-400">
          Notification ~10 min avant la clôture d'une bougie USDJPY, sur les timeframes activés.
        </p>
        {alertError && <p className="mt-2 text-sm text-red-400">{alertError}</p>}
        <div className="mt-3 flex gap-2">
          {[
            ['h1', 'H1'],
            ['h4', 'H4'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleAlertTimeframe(key)}
              className={`min-h-10 rounded-full px-5 text-sm font-semibold ${
                alertSettings[key] ? 'bg-indigo-600 text-white' : 'bg-white/10 text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
