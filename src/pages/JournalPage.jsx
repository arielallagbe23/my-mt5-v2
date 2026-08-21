import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { PAGE } from '../lib/layout'
import { JournalHeader } from '../components/journal/JournalHeader'
import { NetPnlCard } from '../components/journal/NetPnlCard'
import { KpiGrid } from '../components/journal/KpiGrid'
import { PerformanceCard } from '../components/journal/PerformanceCard'
import { ResultsBreakdownCard } from '../components/journal/ResultsBreakdownCard'
import { TradingCalendarCard } from '../components/journal/TradingCalendarCard'
import { BestWorstStreakCard } from '../components/journal/BestWorstStreakCard'
import { MonthlyPnlCard } from '../components/journal/MonthlyPnlCard'
import { TransactionsTable } from '../components/journal/TransactionsTable'
import {
  computeKpis,
  computeStreak,
  computeBreakdown,
  computeMonthly,
  computeDailyNet,
  computeCurve,
  computeTodayNet,
  exportCsv,
  exportHtml,
} from '../components/journal/journalStats'

const PAGE_SIZE = 10

export function JournalPage() {
  const [trades, setTrades] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [accountSize, setAccountSize] = useState(null)

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
    api
      .accountStatus()
      .then((data) => {
        const size = data.accounts?.[String(data.login)]?.account_size
        if (typeof size === 'number') setAccountSize(size)
      })
      .catch(() => {})
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
  const todayNet = useMemo(() => (trades ? computeTodayNet(trades) : null), [trades])
  const breakdown = useMemo(() => (trades ? computeBreakdown(trades, accountSize) : null), [trades, accountSize])
  const dailyNet = useMemo(() => (trades ? computeDailyNet(trades) : new Map()), [trades])
  const monthly = useMemo(() => (trades ? computeMonthly(trades) : []), [trades])
  const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const currentMonthNet = monthly.find(([key]) => key === currentMonthKey)?.[1] ?? null
  const currentMonthR = currentMonthNet != null && kpis?.riskUnit ? currentMonthNet / kpis.riskUnit : null
  const dollarCurve = useMemo(() => (trades ? computeCurve(trades) : []), [trades])
  // Le % est toujours rapporté au capital de base FIXE (account_size), jamais
  // à l'équité live — même règle que le sizing des tâches (risk_sizing_strategy).
  // Tant que account_size n'est pas encore chargé, on retombe sur les dollars.
  const curveUnit = accountSize ? 'pct' : 'usd'
  const curve = useMemo(
    () => (accountSize ? dollarCurve.map((v) => (v / accountSize) * 100) : dollarCurve),
    [dollarCurve, accountSize],
  )

  const totalPages = trades ? Math.max(1, Math.ceil(trades.length / PAGE_SIZE)) : 1
  const pageTrades = trades ? trades.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []

  return (
    <div className={PAGE}>
      <JournalHeader
        tradesCount={trades?.length ?? null}
        onExportCsv={() => trades && exportCsv(trades)}
        onExportHtml={() => trades && exportHtml(trades)}
        exportDisabled={!trades || trades.length === 0}
        onSync={handleSync}
        syncing={syncing}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Chargement...</p>}
      {!loading && trades && trades.length === 0 && (
        <p className="text-sm text-slate-400">
          Aucun trade enregistré pour le moment. Appuie sur "Actualiser" pour importer ton historique MT5.
        </p>
      )}

      {kpis && trades.length > 0 && (
        <>
          <NetPnlCard netTotal={kpis.netTotal} />
          <KpiGrid kpis={kpis} currentMonthR={currentMonthR} />
          <PerformanceCard netTotal={kpis.netTotal} curve={curve} unit={curveUnit} accountSize={accountSize} />
          <ResultsBreakdownCard breakdown={breakdown} />
          <TradingCalendarCard dailyNet={dailyNet} />
          <BestWorstStreakCard kpis={kpis} streak={streak} todayNet={todayNet} accountSize={accountSize} />
          <MonthlyPnlCard monthly={monthly} />
          <TransactionsTable
            trades={trades}
            pageTrades={pageTrades}
            page={page}
            totalPages={totalPages}
            onPrevPage={() => setPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        </>
      )}
    </div>
  )
}
