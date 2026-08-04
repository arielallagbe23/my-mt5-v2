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

export function HomePage({ onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [netPnl, setNetPnl] = useState(null)
  const [reports, setReports] = useState([])
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
    api
      .trades()
      .then((res) => setNetPnl(res.trades.reduce((sum, t) => sum + t.net, 0)))
      .catch(() => {})
    api.reports().then(setReports).catch(() => {})
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

      <button
        type="button"
        onClick={() => onNavigate?.('journal')}
        className={`rounded-2xl border p-4 text-left ${
          netPnl === null
            ? 'border-white/10 bg-white/5'
            : netPnl >= 0
              ? 'border-green-500/30 bg-green-500/10'
              : 'border-red-500/30 bg-red-500/10'
        }`}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Journal — P&amp;L net</p>
          <span className="text-xs text-slate-500">Voir le détail →</span>
        </div>
        <p
          className={`mt-1 text-2xl font-bold ${
            netPnl === null ? 'text-white' : netPnl >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {netPnl === null ? '—' : `${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} $`}
        </p>
      </button>

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
        <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Positions ouvertes</p>
        {loading && !data && <p className="text-sm text-slate-400">Chargement...</p>}
        {!loading && positions.length === 0 && <p className="text-sm text-slate-400">Aucune position ouverte.</p>}
        {positions.map((p) => (
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
                  typeof p.profit === 'number' && p.profit >= 0 ? 'text-green-400' : 'text-red-400'
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
        ))}
      </section>
    </div>
  )
}
