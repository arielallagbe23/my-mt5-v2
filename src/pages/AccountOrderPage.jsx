import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'
import { ScenarioToggle } from '../components/tasks/ScenarioToggle'
import { computeGrowthPercent, computeAutoRisk, RISK_STRATEGY_PRESETS } from '../lib/riskTiers'

// Mêmes constantes que mt5-vps/config.py — uniquement pour l'aperçu du lot
// affiché avant l'envoi. Le calcul qui compte réellement est refait côté
// VPS avec compute_lot_size au moment de l'ordre (prix/compte les plus à jour).
const CONTRACT_SIZE = 100000
const FEE_BUFFER = 0.05
const MAX_RISK_PERCENT = 2
const RISK_PRESETS = ['0.5', '1', '1.5', '2']

function previewLot(riskAmount, entry, sl, currentPrice) {
  if (!riskAmount || !Number.isFinite(entry) || !Number.isFinite(sl) || !currentPrice) return null
  const distance = Math.abs(entry - sl)
  if (!distance) return null
  const riskPerLot = (distance * CONTRACT_SIZE) / currentPrice
  if (!riskPerLot) return null
  const lots = (riskAmount / riskPerLot) * (1 - FEE_BUFFER)
  return Math.max(0.01, Math.round(lots * 100) / 100)
}

export function AccountOrderPage() {
  const [accounts, setAccounts] = useState(null)
  const [vpsId, setVpsId] = useState(null)

  const [side, setSide] = useState('buy')
  const [orderKind, setOrderKind] = useState('market')
  const [entry, setEntry] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [risk, setRisk] = useState('1')
  const [customRisk, setCustomRisk] = useState(false)

  const [livePrice, setLivePrice] = useState(null)

  const [confirming, setConfirming] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendResult, setSendResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    requestAndPoll({
      request: () => api.requestPrice('USDJPY'),
      fetch: () => api.price('USDJPY'),
      isFresh: isFreshTs,
      isCancelled: () => cancelled,
    }).then((data) => {
      if (!cancelled && data) setLivePrice(data)
    })
    api
      .allAccountsStatus()
      .then((data) => {
        setAccounts(data)
        const firstId = Object.keys(data)[0]
        if (firstId) setVpsId(firstId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const info = vpsId ? accounts?.[vpsId] : null
  const accountSize = info?.accountSize ?? null
  const equity = info?.equity ?? null
  const riskStrategy = info?.riskStrategy ?? 'manual'

  // Même mécanisme que SetOrderPage.jsx/TaskLauncher.jsx : si le compte
  // choisi a une Stratégie de risque (≠ manuel), le risque est calculé
  // automatiquement depuis sa propre croissance d'équité — pas de choix
  // manuel dans ce cas.
  const riskMode = riskStrategy === 'manual' ? 'manual' : 'auto'
  const riskPreset = RISK_STRATEGY_PRESETS[riskStrategy]
  const growthPercent = computeGrowthPercent(equity, accountSize)
  const autoRiskPercent = riskPreset ? computeAutoRisk(growthPercent, riskPreset.tiers, riskPreset.capRisk) : null

  useEffect(() => {
    if (riskMode === 'auto' && autoRiskPercent != null) {
      setRisk(String(autoRiskPercent))
    }
  }, [riskMode, autoRiskPercent])

  const parsedSl = parseFloat(sl)
  const parsedTp = parseFloat(tp)
  const parsedRisk = parseFloat(risk)
  const parsedEntry = orderKind === 'pending' ? parseFloat(entry) : null
  const marketEntry = livePrice ? (side === 'buy' ? livePrice.ask : livePrice.bid) : null
  const effectiveEntry = orderKind === 'market' ? marketEntry : parsedEntry

  const riskAmount = accountSize != null && Number.isFinite(parsedRisk) ? (parsedRisk / 100) * accountSize : null
  const lotPreview = previewLot(riskAmount, effectiveEntry, parsedSl, livePrice?.bid)

  function resetOutcome() {
    setSendError('')
    setSendResult(null)
  }

  function handleReviewClick() {
    resetOutcome()
    setValidationError('')

    if (!vpsId) {
      setValidationError('Choisis un compte.')
      return
    }
    if (orderKind === 'pending' && !Number.isFinite(parsedEntry)) {
      setValidationError("Renseigne le prix d'entrée.")
      return
    }
    if (!Number.isFinite(parsedSl)) {
      setValidationError('Renseigne le SL.')
      return
    }
    if (tp !== '' && !Number.isFinite(parsedTp)) {
      setValidationError('TP invalide.')
      return
    }
    if (!Number.isFinite(parsedRisk) || parsedRisk <= 0 || parsedRisk > MAX_RISK_PERCENT) {
      setValidationError(`Risque invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%).`)
      return
    }
    setConfirming(true)
  }

  async function handleConfirmSend() {
    resetOutcome()
    setSending(true)

    const orderBody = {
      side,
      orderKind,
      entry: orderKind === 'pending' ? parsedEntry : null,
      sl: parsedSl,
      tp: tp !== '' ? parsedTp : null,
      risk: parsedRisk,
    }

    try {
      await api.requestAccountOrder(vpsId, orderBody)
    } catch (err) {
      setSendError(err.message)
      setSending(false)
      return
    }

    try {
      const result = await requestAndPoll({
        request: () => Promise.resolve(),
        fetch: () => api.accountOrderResult(vpsId),
        isFresh: isFreshTs,
      })
      if (!result) {
        setSendError('VPS indisponible — impossible de confirmer le résultat.')
      } else {
        setSendResult(result)
        setConfirming(false)
      }
    } finally {
      setSending(false)
    }
  }

  const accountEntries = accounts ? Object.entries(accounts) : []

  return (
    <div className={`${PAGE} lg:mx-0`}>
      <h1 className={PAGE_TITLE}>Ordre par compte</h1>
      <p className="text-sm text-slate-400">
        {livePrice ? `USDJPY bid ${livePrice.bid} / ask ${livePrice.ask}` : 'Récupération du prix...'}
      </p>

      <label className="flex flex-col gap-1.5 text-xs text-slate-400">
        <div>Compte</div>
        <select
          value={vpsId ?? ''}
          onChange={(e) => setVpsId(e.target.value)}
          className={`${FIELD_INPUT} appearance-none`}
        >
          {accountEntries.length === 0 && <option value="">Chargement...</option>}
          {accountEntries.map(([id, acc]) => (
            <option key={id} value={id}>
              {acc.pseudo || id} — {acc.login ?? '—'}
            </option>
          ))}
        </select>
      </label>

      <ScenarioToggle scenario={side} onToggle={setSide} />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setOrderKind('market')}
          className={`min-h-10 flex-1 rounded-sm text-sm font-semibold transition-colors ${
            orderKind === 'market' ? 'bg-amber-600 text-white' : 'bg-amber-500/15 text-amber-300'
          }`}
        >
          Marché
        </button>
        <button
          type="button"
          onClick={() => setOrderKind('pending')}
          className={`min-h-10 flex-1 rounded-sm text-sm font-semibold transition-colors ${
            orderKind === 'pending' ? 'bg-amber-600 text-white' : 'bg-amber-500/15 text-amber-300'
          }`}
        >
          {side === 'buy' ? 'Buy Limit' : 'Sell Limit'}
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-sm border border-white/10 bg-white/5 p-3">
        {orderKind === 'pending' ? (
          <label className="flex flex-col gap-1.5 text-xs text-slate-400">
            <div>Prix d'entrée (PE)</div>
            <input
              type="number"
              inputMode="decimal"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className={FIELD_INPUT}
            />
          </label>
        ) : (
          <p className="text-xs text-slate-400">
            Entrée : <span className="font-semibold text-white">{marketEntry ?? '—'}</span> (prix marché live)
          </p>
        )}

        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          <div>SL</div>
          <input type="number" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} className={FIELD_INPUT} />
        </label>

        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          <div>TP (optionnel — modifiable plus tard, comme sur MT5)</div>
          <input type="number" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} className={FIELD_INPUT} />
        </label>

        <label className="flex flex-col gap-1.5 text-xs text-slate-400">
          <div>Risque</div>
          {riskMode === 'auto' ? (
            <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-2">
              <p className="text-sm font-semibold text-white">{risk !== '' ? `${risk}%` : '—'} (auto)</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {typeof growthPercent === 'number'
                  ? `Calculé depuis la croissance de l'équité de ce compte (${growthPercent >= 0 ? '+' : ''}${growthPercent.toFixed(2)}%) — voir Mes comptes.`
                  : 'Calculé automatiquement — voir Mes comptes.'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                {RISK_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setRisk(preset)
                      setCustomRisk(false)
                    }}
                    className={`min-h-9 flex-1 rounded-sm text-sm font-semibold transition-colors ${
                      !customRisk && risk === preset ? 'bg-amber-600 text-white' : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomRisk(true)}
                  className={`min-h-9 flex-1 rounded-sm text-sm font-semibold transition-colors ${
                    customRisk ? 'bg-amber-600 text-white' : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  Autre
                </button>
              </div>
              {customRisk && (
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={MAX_RISK_PERCENT}
                  step="0.1"
                  placeholder={`Max ${MAX_RISK_PERCENT}%`}
                  value={risk}
                  onChange={(e) => setRisk(e.target.value)}
                  className={FIELD_INPUT}
                />
              )}
            </>
          )}
        </label>

        {riskAmount != null && (
          <p className="text-xs text-slate-400">
            Montant risqué : <span className="font-semibold text-white">{riskAmount.toFixed(2)}</span>
            {lotPreview != null && (
              <>
                {' '}
                · Lot estimé : <span className="font-semibold text-white">{lotPreview}</span>
              </>
            )}
          </p>
        )}

        {validationError && <p className="text-sm text-red-400">{validationError}</p>}

        <button
          type="button"
          onClick={handleReviewClick}
          className="min-h-10 rounded-sm bg-amber-600 text-sm font-semibold text-white"
        >
          Envoyer
        </button>
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-bold tracking-[0.14em] text-amber-300 uppercase">Confirme l'envoi</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300">
            <span className="col-span-2">
              Compte : <span className="font-semibold text-white">{info?.pseudo || vpsId}</span>
            </span>
            <span>
              Sens : <span className="font-semibold text-white">{side === 'buy' ? 'Acheter' : 'Vendre'}</span>
            </span>
            <span>
              Type : <span className="font-semibold text-white">{orderKind === 'market' ? 'Marché' : 'Différé'}</span>
            </span>
            <span>
              Entrée : <span className="font-semibold text-white">{effectiveEntry ?? '—'}</span>
            </span>
            <span>
              SL : <span className="font-semibold text-white">{parsedSl}</span>
            </span>
            <span>
              TP : <span className="font-semibold text-white">{tp !== '' ? parsedTp : '—'}</span>
            </span>
            <span>
              Risque : <span className="font-semibold text-white">{parsedRisk}%</span>
            </span>
            <span className="col-span-2">
              Lot : <span className="font-semibold text-white">{lotPreview ?? '—'}</span> (recalculé au moment de
              l'envoi)
            </span>
          </div>
          {sendError && <p className="text-sm text-red-400">{sendError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={sending}
              className="min-h-10 flex-1 rounded-sm border border-white/10 bg-white/5 text-sm font-semibold text-slate-300 disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirmSend}
              disabled={sending}
              className="min-h-10 flex-1 rounded-sm bg-amber-600 text-sm font-semibold text-white disabled:opacity-60"
            >
              {sending ? '...' : "Confirmer l'envoi"}
            </button>
          </div>
        </div>
      )}

      {sendResult && (
        <div
          className={`rounded-sm border p-3 text-sm ${
            sendResult.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}
        >
          {sendResult.success
            ? sendResult.dryRun
              ? `[DRY-RUN] Ordre simulé — ${sendResult.side} ${sendResult.orderKind} @ ${sendResult.entry} SL ${sendResult.sl} lot ${sendResult.lot}`
              : `Ordre envoyé — ticket ${sendResult.ticket} (lot ${sendResult.lot})`
            : `Échec : ${sendResult.error}`}
        </div>
      )}
    </div>
  )
}
