import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'
import { formatPrice } from '../lib/fibo'
import { formatExecutionTime, formatHistoryTime, slStageLabel } from '../lib/positions'

// Même formule que compute_lot_size / invert_lot_size (mt5-vps/scenario_shared.py)
// — dupliquée ici pour l'aperçu client, comme previewLot dans SetOrderPage.jsx.
// Le calcul qui compte réellement est refait côté VPS au moment de l'envoi.
const CONTRACT_SIZE = 100000
const FEE_BUFFER = 0.05

function invertLotSize(lot, entryPrice, slPrice, currentPrice) {
  const distance = Math.abs(entryPrice - slPrice)
  if (!lot || !distance || !currentPrice) return null
  const riskPerLot = (distance * CONTRACT_SIZE) / currentPrice
  return (lot / (1 - FEE_BUFFER)) * riskPerLot
}

function computeLotSize(riskAmount, entryPrice, slPrice, currentPrice) {
  const distance = Math.abs(entryPrice - slPrice)
  if (!riskAmount || !distance || !currentPrice) return null
  const riskPerLot = (distance * CONTRACT_SIZE) / currentPrice
  if (!riskPerLot) return null
  const lots = (riskAmount / riskPerLot) * (1 - FEE_BUFFER)
  return Math.max(0.01, Math.round(lots * 100) / 100)
}

export function OrdersPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monitoringTimeframes, setMonitoringTimeframes] = useState({})
  const [activatingTicket, setActivatingTicket] = useState(null)
  const [confirmCloseTicket, setConfirmCloseTicket] = useState(null)
  const [closingTicket, setClosingTicket] = useState(null)
  const [closeError, setCloseError] = useState('')
  const [histories, setHistories] = useState({})
  const [scheduledOrders, setScheduledOrders] = useState([])
  const [cancellingScheduledId, setCancellingScheduledId] = useState(null)
  const [livePrice, setLivePrice] = useState(null)
  const [adjustingTicket, setAdjustingTicket] = useState(null)
  const [adjustDraft, setAdjustDraft] = useState({ entry: '', sl: '', tp: '' })
  const [adjustSaving, setAdjustSaving] = useState(false)
  const [adjustError, setAdjustError] = useState('')

  function load() {
    setError('')
    setLoading(true)
    requestAndPoll({
      request: () => api.requestPositions(),
      fetch: () => api.positions(),
      isFresh: isFreshTs,
    })
      .then((result) => {
        if (!result) {
          setError('VPS indisponible — impossible de récupérer les ordres/positions')
          return
        }
        setData(result)
      })
      .finally(() => setLoading(false))
  }

  // Historique de suivi (trailing stop + rapport) par position, une seule
  // requête par ticket suivi — pas la peine de la relire à chaque poll de
  // "load()", juste quand la liste des positions suivies change.
  useEffect(() => {
    const trackedTickets = (data?.positions ?? []).filter((p) => p.managedTimeframe).map((p) => p.ticket)
    trackedTickets.forEach((ticket) => {
      api
        .trailingHistory(ticket)
        .then((result) => setHistories((current) => ({ ...current, [ticket]: result.history ?? [] })))
        .catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.positions?.map((p) => p.ticket).join(',')])

  useEffect(() => {
    load()
    api
      .scheduledOrders()
      .then(setScheduledOrders)
      .catch(() => {})
    let cancelled = false
    requestAndPoll({
      request: () => api.requestPrice('USDJPY'),
      fetch: () => api.price('USDJPY'),
      isFresh: isFreshTs,
      isCancelled: () => cancelled,
    }).then((price) => {
      if (!cancelled && price) setLivePrice(price)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function startAdjust(o) {
    setAdjustError('')
    setAdjustDraft({
      entry: String(o.price ?? ''),
      sl: String(o.sl ?? ''),
      tp: o.tp ? String(o.tp) : '',
    })
    setAdjustingTicket(o.ticket)
  }

  function cancelAdjust() {
    setAdjustError('')
    setAdjustingTicket(null)
  }

  async function confirmAdjust(o) {
    const entry = parseFloat(adjustDraft.entry)
    const sl = parseFloat(adjustDraft.sl)
    const tp = adjustDraft.tp.trim() === '' ? null : parseFloat(adjustDraft.tp)
    if (!Number.isFinite(entry) || !Number.isFinite(sl)) {
      setAdjustError('Entrée et SL requis.')
      return
    }
    setAdjustError('')
    setAdjustSaving(true)
    try {
      await api.requestAdjustOrder(o.ticket, { entry, sl, tp })
      const result = await requestAndPoll({
        request: () => Promise.resolve(),
        fetch: () => api.adjustOrderResult(),
        isFresh: isFreshTs,
      })
      if (!result) {
        setAdjustError('VPS indisponible — impossible de confirmer le résultat.')
        return
      }
      if (!result.success) {
        setAdjustError(result.error ?? "Échec de l'ajustement.")
        return
      }
      setAdjustingTicket(null)
      load()
    } finally {
      setAdjustSaving(false)
    }
  }

  async function cancelScheduledOrder(id) {
    setCancellingScheduledId(id)
    try {
      await api.cancelScheduledOrder(id)
      setScheduledOrders((current) => current.filter((o) => o.id !== id))
    } catch {
      api
        .scheduledOrders()
        .then(setScheduledOrders)
        .catch(() => {})
    } finally {
      setCancellingScheduledId(null)
    }
  }

  function setMonitoringTimeframe(ticket, timeframe) {
    setMonitoringTimeframes((current) => ({ ...current, [ticket]: timeframe }))
  }

  async function activateMonitoring(ticket) {
    const timeframe = monitoringTimeframes[ticket] ?? 'H1'
    setActivatingTicket(ticket)
    try {
      await api.activatePositionMonitoring(ticket, timeframe)
      load()
    } catch {
      setError("Impossible d'activer le suivi pour cette position")
    } finally {
      setActivatingTicket(null)
    }
  }

  async function closePosition(ticket) {
    setCloseError('')
    setClosingTicket(ticket)
    try {
      const result = await requestAndPoll({
        request: () => api.requestClosePosition(ticket),
        fetch: () => api.closePositionResult(),
        isFresh: isFreshTs,
      })
      if (!result) {
        setCloseError('VPS indisponible — impossible de confirmer la fermeture.')
        return
      }
      if (!result.success) {
        setCloseError(result.error ?? 'Échec de la fermeture.')
        return
      }
      setConfirmCloseTicket(null)
      load()
    } finally {
      setClosingTicket(null)
    }
  }

  const orders = data?.orders ?? []
  const positions = data?.positions ?? []

  return (
    <div className={`${PAGE} lg:max-w-5xl`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className={PAGE_TITLE}>Mes ordres</h1>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-9 shrink-0 rounded-full bg-amber-500/15 px-4 text-sm font-semibold text-amber-300 disabled:opacity-60"
        >
          {loading ? 'Actualisation...' : 'Actualiser'}
        </button>
      </div>
      <p className="text-sm text-slate-400">Positions en cours et ordres en attente d'exécution.</p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
        <section className="flex flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Positions ouvertes</p>
          {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
          {!loading && positions.length === 0 && <p className="text-sm text-slate-400">Aucune position ouverte.</p>}

          {positions.map((p) => {
            const slStage = slStageLabel(p)
            return (
              <div key={p.ticket} className="rounded-sm border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      p.type === 'Sell' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {p.type}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      typeof p.profit === 'number' && p.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {typeof p.profit === 'number' ? p.profit.toFixed(2) : '—'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Entrée</span>
                    <span className="text-sm font-semibold text-white">{formatPrice(p.priceOpen)}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Actuel</span>
                    <span className="text-sm font-semibold text-white">{formatPrice(p.priceCurrent)}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Volume</span>
                    <span className="text-sm font-semibold text-white">{p.volume}</span>
                  </div>
                </div>
                {slStage && <p className="mt-2 text-xs font-semibold text-amber-300">Actuellement {slStage}</p>}
                <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                  {p.managedTimeframe ? (
                    <>
                      <p className="text-center text-xs font-semibold text-green-400">
                        Suivi actif ({p.managedTimeframe}) — trailing stop + rapport de position
                      </p>
                      {histories[p.ticket]?.length > 0 && (
                        <div className="flex flex-col gap-3 text-xs">
                          {histories[p.ticket].map((h, i) => {
                            const isLast = i === histories[p.ticket].length - 1
                            const isSlMove = h.message?.includes('SL est passé')
                            return (
                              <p
                                key={`${h.ts}-${i}`}
                                className={isSlMove ? `text-amber-300${isLast ? ' font-semibold' : ''}` : 'text-slate-400'}
                              >
                                <span className="text-slate-500">{formatHistoryTime(h.ts)}</span> — {h.message}
                              </p>
                            )
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-xs text-red-400">
                        Suivi inactif — trailing stop et rapport ne s'appliqueront pas
                      </p>
                      <select
                        value={monitoringTimeframes[p.ticket] ?? 'H1'}
                        onChange={(e) => setMonitoringTimeframe(p.ticket, e.target.value)}
                        className="min-h-8 rounded-full border border-white/10 bg-white/5 px-2 text-xs text-white"
                      >
                        <option value="H1">H1</option>
                        <option value="H4">H4</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => activateMonitoring(p.ticket)}
                        disabled={activatingTicket === p.ticket}
                        className="min-h-8 shrink-0 rounded-full bg-amber-500/15 px-3 text-xs font-semibold text-amber-300 disabled:opacity-60"
                      >
                        {activatingTicket === p.ticket ? 'Activation...' : 'Activer'}
                      </button>
                    </div>
                  )}

                  {confirmCloseTicket === p.ticket ? (
                    <div className="flex flex-col gap-2 rounded-sm border border-red-500/30 bg-red-500/10 p-2.5">
                      <p className="text-xs text-red-300">
                        Fermer cette position au prix du marché maintenant ? Irréversible.
                      </p>
                      {closeError && <p className="text-xs text-red-400">{closeError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCloseTicket(null)}
                          disabled={closingTicket === p.ticket}
                          className="min-h-8 flex-1 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-300 disabled:opacity-60"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => closePosition(p.ticket)}
                          disabled={closingTicket === p.ticket}
                          className="min-h-8 flex-1 rounded-full bg-red-600 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {closingTicket === p.ticket ? 'Fermeture...' : 'Confirmer la fermeture'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setCloseError('')
                        setConfirmCloseTicket(p.ticket)
                      }}
                      className="min-h-8 self-start rounded-full border border-red-500/30 px-3 text-xs font-semibold text-red-400"
                    >
                      Fermer en urgence
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>

        <section className="flex flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Ordres différés</p>
          {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
          {!loading && orders.length === 0 && <p className="text-sm text-slate-400">Aucun ordre en attente.</p>}
          {orders.map((o) => {
            const isAdjusting = adjustingTicket === o.ticket
            const draftEntry = parseFloat(adjustDraft.entry)
            const draftSl = parseFloat(adjustDraft.sl)
            const riskAmount = invertLotSize(o.volume, o.price, o.sl, livePrice?.bid)
            const newLotPreview =
              isAdjusting && riskAmount != null
                ? computeLotSize(riskAmount, draftEntry, draftSl, livePrice?.bid)
                : null
            return (
              <div key={o.ticket} className="rounded-sm border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      o.type?.includes('Sell') ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {o.type}
                  </span>
                  <span className="text-xs text-slate-400">
                    {o.symbol} · lot {o.volume}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Prix</span>
                    <span className="text-sm font-semibold text-white">{formatPrice(o.price)}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">SL</span>
                    <span className="text-sm font-semibold text-white">{formatPrice(o.sl)}</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">TP</span>
                    <span className="text-sm font-semibold text-white">{formatPrice(o.tp)}</span>
                  </div>
                </div>

                {isAdjusting ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      Nouvelle entrée
                      <input
                        type="number"
                        inputMode="decimal"
                        value={adjustDraft.entry}
                        onChange={(e) => setAdjustDraft((d) => ({ ...d, entry: e.target.value }))}
                        className={FIELD_INPUT}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      SL
                      <input
                        type="number"
                        inputMode="decimal"
                        value={adjustDraft.sl}
                        onChange={(e) => setAdjustDraft((d) => ({ ...d, sl: e.target.value }))}
                        className={FIELD_INPUT}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      TP (optionnel)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={adjustDraft.tp}
                        onChange={(e) => setAdjustDraft((d) => ({ ...d, tp: e.target.value }))}
                        className={FIELD_INPUT}
                      />
                    </label>
                    <p className="text-xs text-slate-400">
                      Nouveau lot estimé :{' '}
                      <span className="font-semibold text-white">{newLotPreview ?? '—'}</span> — risque alloué
                      inchangé
                    </p>
                    {adjustError && <p className="text-xs text-red-400">{adjustError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={cancelAdjust}
                        disabled={adjustSaving}
                        className="min-h-8 flex-1 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-300 disabled:opacity-60"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmAdjust(o)}
                        disabled={adjustSaving}
                        className="min-h-8 flex-1 rounded-full bg-amber-600 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {adjustSaving ? 'Ajustement...' : 'Confirmer'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startAdjust(o)}
                    className="mt-3 min-h-8 self-start rounded-full border border-amber-500/30 px-3 text-xs font-semibold text-amber-300"
                  >
                    Ajuster l'entrée
                  </button>
                )}
              </div>
            )
          })}
        </section>

        <section className="flex flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-4 lg:col-span-2">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
            Ordres programmés {scheduledOrders.length > 0 && `(${scheduledOrders.length})`}
          </p>
          {scheduledOrders.length === 0 && <p className="text-sm text-slate-400">Aucun ordre programmé.</p>}
          {scheduledOrders.map((o) => (
            <div key={o.id} className="rounded-sm border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    o.side === 'sell' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {o.side === 'sell' ? 'Vendre' : 'Acheter'} · {o.orderKind === 'market' ? 'Marché' : 'Différé'}
                </span>
                <span className="text-xs text-slate-400">{formatExecutionTime(o.executionTime)}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">SL</span>
                  <span className="text-sm font-semibold text-white">{formatPrice(o.sl)}</span>
                </div>
                <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">TP</span>
                  <span className="text-sm font-semibold text-white">{o.tp != null ? formatPrice(o.tp) : '—'}</span>
                </div>
                <div className="flex flex-col items-center gap-0.5 rounded-sm bg-white/5 p-2 text-center">
                  <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Risque</span>
                  <span className="text-sm font-semibold text-white">
                    {o.riskType === 'amount' ? `${o.riskAmount}$` : `${o.risk}%`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => cancelScheduledOrder(o.id)}
                disabled={cancellingScheduledId === o.id}
                className="mt-3 min-h-8 rounded-full border border-red-500/30 px-3 text-xs font-semibold text-red-400 disabled:opacity-60"
              >
                {cancellingScheduledId === o.id ? 'Annulation...' : 'Annuler'}
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
