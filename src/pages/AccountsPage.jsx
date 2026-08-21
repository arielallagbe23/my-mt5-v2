import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'

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
    </div>
  )
}
