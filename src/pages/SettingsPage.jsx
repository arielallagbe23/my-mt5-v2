import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { computeGrowthPercent, computeAutoRisk } from '../lib/riskTiers'

const MAX_RISK_PERCENT = 2

export function SettingsPage() {
  const [mode, setMode] = useState('manual')
  const [tiers, setTiers] = useState([])
  const [capRisk, setCapRisk] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const [equity, setEquity] = useState(null)
  const [accountSize, setAccountSize] = useState(null)

  useEffect(() => {
    api
      .riskSettings()
      .then((settings) => {
        setMode(settings.mode)
        setTiers(settings.tiers.map((t) => ({ threshold: String(t.threshold), risk: String(t.risk) })))
        setCapRisk(String(settings.capRisk))
      })
      .catch(() => setSaveError('Impossible de charger les paramètres de risque'))
      .finally(() => setLoading(false))

    api
      .accountStatus()
      .then((data) => {
        setEquity(typeof data.equity === 'number' ? data.equity : null)
        const size = data.accounts?.[String(data.login)]?.account_size
        if (typeof size === 'number') setAccountSize(size)
      })
      .catch(() => {})
  }, [])

  function updateTier(index, field, value) {
    setTiers((current) => current.map((t, i) => (i === index ? { ...t, [field]: value } : t)))
  }

  function addTier() {
    setTiers((current) => [...current, { threshold: '', risk: '' }])
  }

  function removeTier(index) {
    setTiers((current) => current.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setSaveError('')
    setSaved(false)

    const parsedTiers = tiers.map((t) => ({ threshold: parseFloat(t.threshold), risk: parseFloat(t.risk) }))
    const parsedCapRisk = parseFloat(capRisk)

    if (parsedTiers.some((t) => !Number.isFinite(t.threshold) || !Number.isFinite(t.risk))) {
      setSaveError('Remplis tous les paliers (seuil et risque).')
      return
    }
    if (!Number.isFinite(parsedCapRisk)) {
      setSaveError('Renseigne le plafond.')
      return
    }

    setSaving(true)
    try {
      const updated = await api.updateRiskSettings({ mode, tiers: parsedTiers, capRisk: parsedCapRisk })
      setTiers(updated.tiers.map((t) => ({ threshold: String(t.threshold), risk: String(t.risk) })))
      setCapRisk(String(updated.capRisk))
      setSaved(true)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const previewTiers = tiers
    .map((t) => ({ threshold: parseFloat(t.threshold), risk: parseFloat(t.risk) }))
    .filter((t) => Number.isFinite(t.threshold) && Number.isFinite(t.risk))
  const previewCapRisk = parseFloat(capRisk)
  const growthPercent = computeGrowthPercent(equity, accountSize)
  const autoRiskPreview =
    previewTiers.length > 0 && Number.isFinite(previewCapRisk)
      ? computeAutoRisk(growthPercent, previewTiers, previewCapRisk)
      : null

  if (loading) {
    return (
      <div className={PAGE}>
        <h1 className={PAGE_TITLE}>Paramètres</h1>
        <p className="text-sm text-slate-400">Chargement...</p>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Paramètres</h1>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Risque des tâches</p>
        <p className="text-xs text-slate-400">
          En mode auto, le risque d'une tâche est calculé automatiquement à partir de la croissance de l'équité par
          rapport au capital de référence, au moment où tu confirmes la tâche.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`min-h-10 flex-1 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-indigo-500/15 text-indigo-300'
            }`}
          >
            Manuel
          </button>
          <button
            type="button"
            onClick={() => setMode('auto')}
            className={`min-h-10 flex-1 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'auto' ? 'bg-indigo-600 text-white' : 'bg-indigo-500/15 text-indigo-300'
            }`}
          >
            Auto
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-400">Paliers (croissance de l'équité → risque)</p>
          {tiers.map((tier, index) => (
            <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Palier {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeTier(index)}
                  className="min-h-7 rounded-full border border-white/10 px-2.5 text-xs font-semibold text-red-300"
                >
                  Retirer
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  <span>En dessous de +X%</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={tier.threshold}
                    onChange={(e) => updateTier(index, 'threshold', e.target.value)}
                    className={FIELD_INPUT}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  <span>Risque</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    max={MAX_RISK_PERCENT}
                    value={tier.risk}
                    onChange={(e) => updateTier(index, 'risk', e.target.value)}
                    className={FIELD_INPUT}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addTier}
            className="min-h-9 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-slate-300"
          >
            Ajouter un palier
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Plafond (au-delà du dernier palier)</span>
          <input
            type="number"
            inputMode="decimal"
            max={MAX_RISK_PERCENT}
            value={capRisk}
            onChange={(e) => setCapRisk(e.target.value)}
            className={FIELD_INPUT}
          />
        </label>

        {equity != null && accountSize != null && (
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5 text-xs text-slate-400">
            <span>
              Équité
              <br />
              <span className="font-semibold text-white">{equity.toFixed(2)}</span>
            </span>
            <span>
              Croissance
              <br />
              <span className="font-semibold text-white">{growthPercent?.toFixed(2)}%</span>
            </span>
            <span>
              Risque auto
              <br />
              <span className="font-semibold text-white">{autoRiskPreview != null ? `${autoRiskPreview}%` : '—'}</span>
            </span>
          </div>
        )}

        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        {saved && <p className="text-sm text-blue-400">Paramètres enregistrés.</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="min-h-10 rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
