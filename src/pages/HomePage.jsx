import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'

function formatPrice(value) {
  return typeof value === 'number' ? value.toFixed(3) : '—'
}

function formatExecutionTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

// Ordre chronologique des créneaux du jour — voir le tableau des checkpoints
// dans mt5-vps/daily_brief.py (fomc/boj_watch n'apparaissent que si détectés).
const CHECKPOINT_LABELS = {
  morning: 'Matin',
  london_open: 'Ouverture Londres',
  us_data: 'Données US',
  ny_open: 'Ouverture NY',
  fomc: 'FOMC',
  boj_watch: 'BoJ',
}
const CHECKPOINT_ORDER = Object.keys(CHECKPOINT_LABELS)

const EVENT_IMPACT_STYLES = {
  high: 'bg-red-500/15 text-red-300',
  medium: 'bg-amber-500/15 text-amber-300',
}

// Tant qu'une tâche n'a pas encore été évaluée (brouillon ou en attente),
// elle est "à venir" — une fois passée en dry_run_done/done, elle a déjà son
// propre rapport dans la liste des tâches, pas besoin de la garder ici.
const UPCOMING_STATUSES = new Set(['draft', 'pending'])

// Le trailing stop côté VPS ne déplace jamais le SL ailleurs qu'à ces 3
// paliers précis (entrée + 0/25/50% de la distance entrée→TP — voir
// SL_STAGES dans mt5-vps/positions.py). On retrouve le palier actuel en
// comparant le SL courant à ces mêmes niveaux, sans rien demander au VPS.
const SL_STAGES = [
  { pct: 50, label: 'SL à 50%' },
  { pct: 25, label: 'SL à 25%' },
  { pct: 0, label: 'SL à BE' },
]
const SL_STAGE_TOLERANCE_PCT = 2 // marge pour l'arrondi/spread

function slStageLabel(p) {
  if (!p.sl || !p.tp || typeof p.priceOpen !== 'number') return null
  const totalDistance = p.tp - p.priceOpen
  if (!totalDistance) return null
  const progress = ((p.sl - p.priceOpen) / totalDistance) * 100
  return SL_STAGES.find((s) => Math.abs(progress - s.pct) <= SL_STAGE_TOLERANCE_PCT)?.label ?? null
}

export function HomePage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reports, setReports] = useState([])
  const [upcomingTasks, setUpcomingTasks] = useState([])
  const [dailyBrief, setDailyBrief] = useState([])
  const [monitoringTimeframes, setMonitoringTimeframes] = useState({})
  const [activatingTicket, setActivatingTicket] = useState(null)

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

  useEffect(() => {
    load()
    api.reports().then(setReports).catch(() => {})
    api
      .listTasks()
      .then((tasks) =>
        setUpcomingTasks(
          tasks
            .filter((t) => UPCOMING_STATUSES.has(t.status))
            .sort((a, b) => (a.executionTime ?? '').localeCompare(b.executionTime ?? '')),
        ),
      )
      .catch(() => {})
    api.dailyBrief().then(setDailyBrief).catch(() => {})
  }, [])

  async function archiveReport(id) {
    setReports((current) => current.filter((r) => r.id !== id))
    try {
      await api.archiveReport(id)
    } catch {
      api.reports().then(setReports).catch(() => {})
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

  const orders = data?.orders ?? []
  const positions = data?.positions ?? []
  const briefCheckpoints = [...dailyBrief].sort(
    (a, b) => CHECKPOINT_ORDER.indexOf(a.checkpoint) - CHECKPOINT_ORDER.indexOf(b.checkpoint),
  )

  return (
    <div className={PAGE}>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-9 rounded-full bg-indigo-500/15 px-4 text-sm font-semibold text-indigo-300 disabled:opacity-60"
        >
          {loading ? 'Actualisation...' : 'Actualiser'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {reports.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
            Tâches non exécutées ({reports.length})
          </p>
          {reports.map((r) => (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-white">
                    {r.scenario === 'sell' ? 'Vente' : 'Achat'} {r.timeframe} — {formatExecutionTime(r.executionTime)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">L'heure est arrivée mais {r.reason?.toLowerCase()} — tâche supprimée.</p>
                </div>
                <button
                  type="button"
                  onClick={() => archiveReport(r.id)}
                  className="min-h-8 shrink-0 rounded-full border border-white/10 px-3 text-xs font-semibold text-slate-300"
                >
                  Archiver
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
          Tâches à venir {upcomingTasks.length > 0 && `(${upcomingTasks.length})`}
        </p>
        {upcomingTasks.length === 0 && <p className="text-sm text-slate-400">Aucune tâche à venir.</p>}
        {upcomingTasks.map((t) => (
          <div key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  t.scenario === 'sell'
                    ? 'bg-red-500/15 text-red-300'
                    : t.scenario === 'buy'
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'bg-white/10 text-slate-300'
                }`}
              >
                {t.scenario === 'sell' ? 'Vendre' : t.scenario === 'buy' ? 'Acheter' : 'Brouillon'}
              </span>
              <span className="text-xs text-slate-400">{formatExecutionTime(t.executionTime)}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
              <span>
                Timeframe : <span className="font-semibold text-white">{t.timeframe ?? '—'}</span>
              </span>
              <span>
                Risque : <span className="font-semibold text-white">{t.risk != null ? `${t.risk}%` : '—'}</span>
              </span>
              <span>
                Statut : <span className="font-semibold text-white">{t.status === 'draft' ? 'Brouillon' : 'En attente'}</span>
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Positions ouvertes</p>
        {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
        {!loading && positions.length === 0 && <p className="text-sm text-slate-400">Aucune position ouverte.</p>}
        {positions.map((p) => {
          const slStage = slStageLabel(p)
          return (
            <div key={p.ticket} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    p.type === 'Sell' ? 'bg-red-500/15 text-red-300' : 'bg-blue-500/15 text-blue-300'
                  }`}
                >
                  {p.type}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    typeof p.profit === 'number' && p.profit >= 0 ? 'text-blue-400' : 'text-red-400'
                  }`}
                >
                  {typeof p.profit === 'number' ? p.profit.toFixed(2) : '—'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
                <span>
                  Entrée : <span className="font-semibold text-white">{formatPrice(p.priceOpen)}</span>
                </span>
                <span>
                  Actuel : <span className="font-semibold text-white">{formatPrice(p.priceCurrent)}</span>
                </span>
                <span>
                  Volume : <span className="font-semibold text-white">{p.volume}</span>
                </span>
              </div>
              {slStage && <p className="mt-2 text-xs font-semibold text-indigo-300">Actuellement {slStage}</p>}
              {!p.comment?.startsWith('task-') && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  {p.managedTimeframe ? (
                    <p className="text-xs font-semibold text-green-400">
                      Suivi actif ({p.managedTimeframe}) — trailing stop + progression TP
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-xs text-slate-400">Position hors mymt5 — activer le suivi ?</p>
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
                        className="min-h-8 shrink-0 rounded-full bg-indigo-500/15 px-3 text-xs font-semibold text-indigo-300 disabled:opacity-60"
                      >
                        {activatingTicket === p.ticket ? 'Activation...' : 'Activer'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Ordres différés</p>
        {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
        {!loading && orders.length === 0 && <p className="text-sm text-slate-400">Aucun ordre en attente.</p>}
        {orders.map((o) => (
          <div key={o.ticket} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  o.type?.includes('Sell') ? 'bg-red-500/15 text-red-300' : 'bg-blue-500/15 text-blue-300'
                }`}
              >
                {o.type}
              </span>
              <span className="text-xs text-slate-400">{o.symbol}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
              <span>
                Prix : <span className="font-semibold text-white">{formatPrice(o.price)}</span>
              </span>
              <span>
                SL : <span className="font-semibold text-white">{formatPrice(o.sl)}</span>
              </span>
              <span>
                TP : <span className="font-semibold text-white">{formatPrice(o.tp)}</span>
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Brief macro USDJPY</p>
        {briefCheckpoints.length === 0 && <p className="text-sm text-slate-400">Aucun point macro pour aujourd'hui.</p>}
        {briefCheckpoints.map((checkpoint) => (
          <div key={checkpoint.checkpoint} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white">
                {CHECKPOINT_LABELS[checkpoint.checkpoint] ?? checkpoint.checkpoint}
              </span>
              {checkpoint.interventionRisk && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">
                  Risque d'intervention
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-white">{checkpoint.note}</p>
            {checkpoint.overnightMove?.pct != null && (
              <p className="mt-2 text-xs text-slate-400">
                Mouvement nuit :{' '}
                <span className="font-semibold text-white">
                  {formatPrice(checkpoint.overnightMove.fromPrice)} → {formatPrice(checkpoint.overnightMove.toPrice)} (
                  {checkpoint.overnightMove.pct >= 0 ? '+' : ''}
                  {checkpoint.overnightMove.pct}%)
                </span>
              </p>
            )}
            {checkpoint.events?.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {checkpoint.events.map((event, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs text-slate-400">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        EVENT_IMPACT_STYLES[event.impact] ?? EVENT_IMPACT_STYLES.medium
                      }`}
                    >
                      {event.currency}
                    </span>
                    <span>{event.time}</span>
                    <span className="text-slate-300">{event.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
