import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'

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
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(null)
  const [saveError, setSaveError] = useState('')

  const [switchLogin, setSwitchLogin] = useState('')
  const [switchPassword, setSwitchPassword] = useState('')
  const [switchServer, setSwitchServer] = useState('')
  const [switchConfirming, setSwitchConfirming] = useState(false)
  const [switchSending, setSwitchSending] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [switchResult, setSwitchResult] = useState(null)

  function load() {
    return api
      .allAccountsStatus()
      .then((data) => {
        setAccounts(data)
        setEdits((current) => {
          const next = { ...current }
          for (const [vpsId, info] of Object.entries(data)) {
            if (!next[vpsId]) {
              next[vpsId] = { pseudo: info.pseudo ?? '', riskMultiplier: String(info.riskMultiplier ?? 1) }
            }
          }
          return next
        })
      })
      .catch(() => setError('Impossible de charger les comptes'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  function updateEdit(vpsId, field, value) {
    setEdits((current) => ({ ...current, [vpsId]: { ...current[vpsId], [field]: value } }))
  }

  async function saveSettings(vpsId) {
    setSaveError('')
    setSaving(vpsId)
    const edit = edits[vpsId]
    const riskMultiplier = parseFloat(edit.riskMultiplier)
    if (!Number.isFinite(riskMultiplier) || riskMultiplier <= 0) {
      setSaveError('Multiplicateur invalide')
      setSaving(null)
      return
    }
    try {
      await api.updateAccountSettings(vpsId, { pseudo: edit.pseudo.trim() || null, riskMultiplier })
      await load()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(null)
    }
  }

  function handleSwitchReview() {
    setSwitchError('')
    setSwitchResult(null)
    const loginNum = parseInt(switchLogin, 10)
    if (!Number.isInteger(loginNum) || loginNum <= 0) {
      setSwitchError('Login invalide')
      return
    }
    if (!switchPassword) {
      setSwitchError('Mot de passe requis')
      return
    }
    if (!switchServer.trim()) {
      setSwitchError('Serveur requis (ex : FTMO-Server2)')
      return
    }
    setSwitchConfirming(true)
  }

  async function handleSwitchConfirm() {
    setSwitchError('')
    setSwitchSending(true)
    const loginNum = parseInt(switchLogin, 10)
    const password = switchPassword
    // Effacé du state tout de suite — pas la peine de le garder en mémoire
    // le temps de l'aller-retour réseau, une fois qu'il est parti.
    setSwitchPassword('')
    try {
      await api.requestSwitchAccount(loginNum, password, switchServer.trim())
    } catch (err) {
      setSwitchError(err.message)
      setSwitchSending(false)
      return
    }

    try {
      const result = await requestAndPoll({
        request: () => Promise.resolve(),
        fetch: () => api.switchAccountResult(),
        isFresh: isFreshTs,
        attempts: 15,
      })
      if (!result) {
        setSwitchError('VPS indisponible — impossible de confirmer le changement.')
      } else if (!result.success) {
        setSwitchError(result.error ?? 'Échec du changement de compte')
      } else {
        setSwitchResult(result)
        setSwitchConfirming(false)
        setSwitchLogin('')
        setSwitchServer('')
        load()
      }
    } finally {
      setSwitchSending(false)
    }
  }

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
        {entries.map(([vpsId, info]) => {
          const edit = edits[vpsId] ?? { pseudo: '', riskMultiplier: '1' }
          const changed = edit.pseudo !== (info.pseudo ?? '') || edit.riskMultiplier !== String(info.riskMultiplier ?? 1)

          return (
            <li key={vpsId} className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className={`h-2 w-2 shrink-0 rounded-full ${info.online ? 'bg-green-500' : 'bg-slate-600'}`} />
                <span>{info.pseudo || VPS_LABELS[vpsId] || vpsId}</span>
              </div>
              <p className="mt-1 font-semibold text-white">Compte {info.login ?? '—'}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                <span>Équité : {formatAmount(info.equity, info.currency)}</span>
                <span>
                  Taille : {typeof info.accountSize === 'number' ? info.accountSize.toLocaleString('fr-FR') : '—'}
                </span>
                {info.riskMultiplier !== 1 && (
                  <span className="font-semibold text-indigo-300">Risque x{info.riskMultiplier}</span>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                <div className="flex gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
                    Pseudo
                    <input
                      type="text"
                      value={edit.pseudo}
                      onChange={(e) => updateEdit(vpsId, 'pseudo', e.target.value)}
                      placeholder={VPS_LABELS[vpsId] ?? vpsId}
                      maxLength={40}
                      className={FIELD_INPUT}
                    />
                  </label>
                  <label className="flex w-28 flex-col gap-1 text-xs text-slate-400">
                    Multiplicateur
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={edit.riskMultiplier}
                      onChange={(e) => updateEdit(vpsId, 'riskMultiplier', e.target.value)}
                      className={FIELD_INPUT}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => saveSettings(vpsId)}
                  disabled={!changed || saving === vpsId}
                  className="min-h-8 self-start rounded-full bg-indigo-500/15 px-3 text-xs font-semibold text-indigo-300 disabled:opacity-40"
                >
                  {saving === vpsId ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {saveError && <p className="text-sm text-red-400">{saveError}</p>}

      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Changer de compte</p>
          <p className="mt-1 text-xs text-slate-400">
            Nouveau cycle FTMO (login/mot de passe changés) — bascule le compte principal sans avoir à se connecter au VPS.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Login
          <input
            type="number"
            inputMode="numeric"
            value={switchLogin}
            onChange={(e) => setSwitchLogin(e.target.value)}
            placeholder="510999999"
            className={FIELD_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Mot de passe
          <input
            type="password"
            autoComplete="off"
            value={switchPassword}
            onChange={(e) => setSwitchPassword(e.target.value)}
            className={FIELD_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Serveur
          <input
            type="text"
            value={switchServer}
            onChange={(e) => setSwitchServer(e.target.value)}
            placeholder="FTMO-Server2"
            className={FIELD_INPUT}
          />
        </label>

        {switchError && <p className="text-sm text-red-400">{switchError}</p>}

        {switchConfirming ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-300">
              Basculer sur le compte <span className="font-semibold">{switchLogin}</span> ({switchServer}) ? Le VPS se
              déconnectera du compte actuel.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSwitchConfirming(false)}
                disabled={switchSending}
                className="min-h-9 flex-1 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-slate-300 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSwitchConfirm}
                disabled={switchSending}
                className="min-h-9 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
              >
                {switchSending ? 'Connexion...' : 'Confirmer'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSwitchReview}
            className="min-h-9 self-start rounded-full bg-indigo-500/15 px-4 text-sm font-semibold text-indigo-300"
          >
            Changer de compte
          </button>
        )}

        {switchResult && (
          <p className="text-sm text-blue-400">
            Connecté — balance {switchResult.balance?.toFixed(2)} {switchResult.currency} ({switchResult.server})
          </p>
        )}
      </div>
    </div>
  )
}
