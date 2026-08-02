import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { PAGE } from '../lib/layout'

const PAGE_SIZE = 10

function money(value) {
  if (typeof value !== 'number') return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)} $`
}

function pct(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '—'
}

function formatDate(ts) {
  if (typeof ts !== 'number') return '—'
  return new Date(ts * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// --- Calculs purs, à partir de la liste des trades (déjà triée closeTime desc par l'API) ---

function computeKpis(trades) {
  const total = trades.length
  const wins = trades.filter((t) => t.net > 0)
  const losses = trades.filter((t) => t.net < 0)
  const netTotal = trades.reduce((sum, t) => sum + t.net, 0)
  const grossWin = wins.reduce((sum, t) => sum + t.net, 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.net, 0))

  return {
    total,
    netTotal,
    winRate: total ? (wins.length / total) * 100 : null,
    winCount: wins.length,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    best: trades.reduce((m, t) => (m === null || t.net > m.net ? t : m), null),
    worst: trades.reduce((m, t) => (m === null || t.net < m.net ? t : m), null),
  }
}

function computeStreak(trades) {
  // trades est trié du plus récent au plus ancien
  if (trades.length === 0) return null
  const isWin = trades[0].net > 0
  let count = 0
  for (const t of trades) {
    if (t.net > 0 === isWin) count++
    else break
  }
  return { isWin, count }
}

function computeBreakdown(trades) {
  let tp = 0
  let slLoss = 0
  let slProtected = 0
  let other = 0
  for (const t of trades) {
    if (t.reason === 'TP') tp++
    else if (t.reason === 'SL') {
      if (t.net >= 0) slProtected++
      else slLoss++
    } else other++
  }
  return { tp, slLoss, slProtected, other, total: trades.length }
}

function computeMonthly(trades) {
  const byMonth = new Map()
  for (const t of trades) {
    const d = new Date(t.closeTime * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.net)
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function computeCurve(trades) {
  const chronological = [...trades].sort((a, b) => a.closeTime - b.closeTime)
  let cumulative = 0
  return chronological.map((t) => {
    cumulative += t.net
    return cumulative
  })
}

function exportCsv(trades) {
  const header = 'Date,Symbole,Type,Volume,PrixOuverture,PrixCloture,Profit,Swap,Commission,Net,Raison\n'
  const rows = trades
    .map((t) =>
      [
        new Date(t.closeTime * 1000).toLocaleString('fr-FR'),
        t.symbol,
        t.type,
        t.volume,
        t.priceOpen,
        t.priceClose,
        t.profit.toFixed(2),
        t.swap.toFixed(2),
        t.commission.toFixed(2),
        t.net.toFixed(2),
        t.reason,
      ].join(','),
    )
    .join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv' })
  const file = new File([blob], 'journal.csv', { type: 'text/csv' })

  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Journal mymt5' }).catch(() => {})
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'journal.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function PerformanceCurve({ curve }) {
  if (curve.length < 2) {
    return <p className="text-sm text-slate-400">Pas assez de trades pour tracer une courbe.</p>
  }
  const min = Math.min(0, ...curve)
  const max = Math.max(0, ...curve)
  const range = max - min || 1
  const points = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * 100
      const y = 100 - ((v - min) / range) * 100
      return `${x},${y}`
    })
    .join(' ')
  const zeroY = 100 - ((0 - min) / range) * 100
  const last = curve[curve.length - 1]

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 w-full">
      <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" strokeWidth="0.3" className="text-white/15" />
      <polyline
        points={points}
        fill="none"
        stroke={last >= 0 ? '#4ade80' : '#f87171'}
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function Donut({ breakdown }) {
  const { tp, slLoss, slProtected, other, total } = breakdown
  if (total === 0) return null

  const segments = [
    { value: tp, color: '#60a5fa', label: 'Take Profit' },
    { value: slLoss, color: '#f87171', label: 'Stop Loss' },
    { value: slProtected, color: '#4ade80', label: 'SL protégé (BE+)' },
    { value: other, color: '#fbbf24', label: 'Autre' },
  ].filter((s) => s.value > 0)

  let acc = 0
  const stops = segments
    .map((s) => {
      const start = (acc / total) * 100
      acc += s.value
      const end = (acc / total) * 100
      return `${s.color} ${start}% ${end}%`
    })
    .join(', ')

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="h-40 w-40 rounded-full"
        style={{ background: `conic-gradient(${stops})`, WebkitMaskImage: 'radial-gradient(circle, transparent 55%, black 56%)', maskImage: 'radial-gradient(circle, transparent 55%, black 56%)' }}
      />
      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-400">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span>
              {s.label} <span className="font-semibold text-white">{Math.round((s.value / total) * 100)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthlyBars({ monthly }) {
  if (monthly.length === 0) return null
  const maxAbs = Math.max(...monthly.map(([, v]) => Math.abs(v)), 1)

  return (
    <div className="flex h-24 items-end gap-2">
      {monthly.map(([key, value]) => (
        <div key={key} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`w-full rounded-t ${value >= 0 ? 'bg-blue-500' : 'bg-red-500'}`}
            style={{ height: `${Math.max(4, (Math.abs(value) / maxAbs) * 80)}px` }}
          />
          <span className="text-[10px] text-slate-500">{key.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

export function JournalPage() {
  const [trades, setTrades] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  function load() {
    setError('')
    api
      .trades()
      .then((data) => setTrades(data.trades))
      .catch(() => setError('Impossible de charger le journal'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSync() {
    setSyncing(true)
    setError('')
    try {
      await api.syncTrades()
      await new Promise((resolve) => setTimeout(resolve, 12000))
      await api.trades().then((data) => setTrades(data.trades))
    } catch {
      setError('Synchronisation impossible')
    } finally {
      setSyncing(false)
    }
  }

  const kpis = useMemo(() => (trades ? computeKpis(trades) : null), [trades])
  const streak = useMemo(() => (trades ? computeStreak(trades) : null), [trades])
  const breakdown = useMemo(() => (trades ? computeBreakdown(trades) : null), [trades])
  const monthly = useMemo(() => (trades ? computeMonthly(trades) : []), [trades])
  const curve = useMemo(() => (trades ? computeCurve(trades) : []), [trades])

  const totalPages = trades ? Math.max(1, Math.ceil(trades.length / PAGE_SIZE)) : 1
  const pageTrades = trades ? trades.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []

  return (
    <div className={PAGE}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Journal</h1>
          <p className="text-sm text-slate-400">{trades ? `${trades.length} trades · tout l'historique` : '...'}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => trades && exportCsv(trades)}
            disabled={!trades || trades.length === 0}
            className="min-h-9 rounded-full border border-white/10 px-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Exporter
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="min-h-9 rounded-full border border-white/10 px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {syncing ? 'Synchro...' : 'Actualiser'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Chargement...</p>}
      {!loading && trades && trades.length === 0 && (
        <p className="text-sm text-slate-400">
          Aucun trade enregistré pour le moment. Appuie sur "Actualiser" pour importer ton historique MT5.
        </p>
      )}

      {kpis && trades.length > 0 && (
        <>
          <div
            className={`rounded-3xl border p-6 ${
              kpis.netTotal >= 0 ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'
            }`}
          >
            <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L net total</p>
            <p className={`mt-1 text-4xl font-bold ${kpis.netTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {money(kpis.netTotal)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-400 uppercase">Win rate</p>
              <p className="text-xl font-bold text-white">{pct(kpis.winRate)}</p>
              <p className="text-xs text-slate-500">
                {kpis.winCount} / {kpis.total}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-400 uppercase">Profit factor</p>
              <p className="text-xl font-bold text-white">
                {kpis.profitFactor === null ? '—' : kpis.profitFactor.toFixed(2)}
              </p>
              <p className="text-xs text-slate-500">
                {kpis.profitFactor === null ? '—' : kpis.profitFactor >= 1 ? 'favorable' : 'défavorable'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-400 uppercase">Gain moyen</p>
              <p className="text-xl font-bold text-blue-400">{money(kpis.avgWin)}</p>
              <p className="text-xs text-slate-500">par trade gagnant</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-slate-400 uppercase">Perte moyenne</p>
              <p className="text-xl font-bold text-red-400">{money(kpis.avgLoss)}</p>
              <p className="text-xs text-slate-500">par trade perdant</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Courbe de performance</p>
              <span className={`text-sm font-semibold ${kpis.netTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {money(kpis.netTotal)}
              </span>
            </div>
            <PerformanceCurve curve={curve} />
            <p className="mt-1 text-xs text-slate-500">P&amp;L cumulé, en dollars</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Répartition des résultats</p>
            <Donut breakdown={breakdown} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between border-b border-white/10 py-2">
              <span className="text-xs text-slate-400 uppercase">Meilleur trade</span>
              <span className="text-sm font-semibold text-green-400">{kpis.best ? money(kpis.best.net) : '—'}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/10 py-2">
              <span className="text-xs text-slate-400 uppercase">Pire trade</span>
              <span className="text-sm font-semibold text-red-400">{kpis.worst ? money(kpis.worst.net) : '—'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-slate-400 uppercase">Série en cours</span>
              <span className={`text-sm font-semibold ${streak?.isWin ? 'text-green-400' : 'text-red-400'}`}>
                {streak ? `${streak.count} ${streak.isWin ? 'victoire(s)' : 'défaite(s)'}` : '—'}
              </span>
            </div>
          </div>

          {monthly.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L mensuel</p>
              <MonthlyBars monthly={monthly} />
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Transactions</p>
              <span className="text-xs text-slate-500">{trades.length} au total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="pb-2 pr-2 font-normal">Date</th>
                    <th className="pb-2 pr-2 font-normal">Type</th>
                    <th className="pb-2 pr-2 font-normal">Vol.</th>
                    <th className="pb-2 pr-2 font-normal">Prix</th>
                    <th className="pb-2 font-normal">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTrades.map((t) => (
                    <tr key={t.positionId} className="border-t border-white/5">
                      <td className="py-2 pr-2 whitespace-nowrap text-slate-400">{formatDate(t.closeTime)}</td>
                      <td className={`py-2 pr-2 font-semibold ${t.type === 'Sell' ? 'text-red-400' : 'text-blue-400'}`}>
                        {t.type === 'Sell' ? 'SELL' : 'BUY'}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">{t.volume}</td>
                      <td className="py-2 pr-2 text-slate-300">{t.priceClose}</td>
                      <td className={`py-2 font-semibold ${t.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {money(t.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
                >
                  ← Préc.
                </button>
                <span className="text-xs text-slate-500">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Suiv. →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
