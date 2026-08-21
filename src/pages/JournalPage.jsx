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
import { parseTradeHistoryCsv } from '../components/journal/importCsv'

const PAGE_SIZE = 10

export function JournalPage() {
  const [trades, setTrades] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [accountSize, setAccountSize] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')

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

  async function handleImportFile(file) {
    setImporting(true)
    setImportResult('')
    setError('')
    try {
      const text = await file.text()
      const { trades: parsed, skipped: unparsed } = parseTradeHistoryCsv(text)
      if (parsed.length === 0) {
        setError("Aucun trade valide trouvé dans ce fichier — vérifie que c'est bien un export d'historique MT5.")
        return
      }
      const { imported, skipped } = await api.importTrades(parsed)
      setImportResult(
        `${imported} trade${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}` +
          (skipped > 0 ? `, ${skipped} déjà présent${skipped > 1 ? 's' : ''} (ignoré${skipped > 1 ? 's' : ''})` : '') +
          (unparsed > 0 ? `, ${unparsed} ligne${unparsed > 1 ? 's' : ''} illisible${unparsed > 1 ? 's' : ''}` : ''),
      )
      load()
    } catch (err) {
      setError(err.message || "Échec de l'import")
    } finally {
      setImporting(false)
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

  // Même courbe, mais sur le trimestre en cours uniquement — mise en avant à
  // la place de la courbe globale (déplacée tout en bas), pour ne pas ouvrir
  // le Journal sur le chiffre le plus flatteur. Un seul mois était trop
  // court pour être lisible.
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentQuarter = Math.floor(now.getMonth() / 3) // 0-3
  const currentQuarterLabel = `T${currentQuarter + 1} ${currentYear}`
  const currentQuarterTrades = useMemo(
    () =>
      (trades ?? []).filter((t) => {
        const d = new Date(t.closeTime * 1000)
        return d.getFullYear() === currentYear && Math.floor(d.getMonth() / 3) === currentQuarter
      }),
    [trades, currentYear, currentQuarter],
  )
  const quarterlyNet = currentQuarterTrades.reduce((sum, t) => sum + t.net, 0)
  const quarterlyDollarCurve = useMemo(() => computeCurve(currentQuarterTrades), [currentQuarterTrades])
  const quarterlyCurve = useMemo(
    () => (accountSize ? quarterlyDollarCurve.map((v) => (v / accountSize) * 100) : quarterlyDollarCurve),
    [quarterlyDollarCurve, accountSize],
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
        onImportFile={handleImportFile}
        importing={importing}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {importResult && <p className="text-sm text-blue-400">{importResult}</p>}
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
          <PerformanceCard
            netTotal={quarterlyNet}
            curve={quarterlyCurve}
            unit={curveUnit}
            accountSize={accountSize}
            title={`Courbe de performance — ${currentQuarterLabel}`}
          />
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
          <PerformanceCard
            netTotal={kpis.netTotal}
            curve={curve}
            unit={curveUnit}
            accountSize={accountSize}
            title="Courbe de performance — globale"
          />
        </>
      )}
    </div>
  )
}
