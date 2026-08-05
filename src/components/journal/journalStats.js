// Calculs purs et formatteurs partagés par les cartes du Journal, à partir de
// la liste des trades (déjà triée closeTime desc par l'API).

export function money(value) {
  if (typeof value !== 'number') return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)} $`
}

export function pct(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '—'
}

export function formatSignedPct(value) {
  return typeof value === 'number' ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—'
}

export function formatVolume(value) {
  return typeof value === 'number' ? value.toFixed(2) : '—'
}

export function formatDate(ts) {
  if (typeof ts !== 'number') return '—'
  return new Date(ts * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function formatAxisValue(value, unit) {
  return unit === 'pct' ? formatSignedPct(value) : money(value)
}

export function computeKpis(trades) {
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

export function computeStreak(trades) {
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

export function computeBreakdown(trades) {
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

export function computeMonthly(trades) {
  const byMonth = new Map()
  for (const t of trades) {
    const d = new Date(t.closeTime * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.net)
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function computeCurve(trades) {
  const chronological = [...trades].sort((a, b) => a.closeTime - b.closeTime)
  let cumulative = 0
  return chronological.map((t) => {
    cumulative += t.net
    return cumulative
  })
}

export function exportCsv(trades) {
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
