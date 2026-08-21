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

export function formatR(value) {
  return typeof value === 'number' ? `${value >= 0 ? '+' : ''}${value.toFixed(2)} R` : '—'
}

export function computeKpis(trades) {
  const total = trades.length
  const wins = trades.filter((t) => t.net > 0)
  const losses = trades.filter((t) => t.net < 0)
  const netTotal = trades.reduce((sum, t) => sum + t.net, 0)
  const grossWin = wins.reduce((sum, t) => sum + t.net, 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.net, 0))
  const avgLoss = losses.length ? -grossLoss / losses.length : null

  // 1R = la perte moyenne observée (en valeur absolue) — pas de risque
  // déclaré à l'entrée stocké par trade, donc on prend comme unité de
  // référence ce qui a été RÉELLEMENT perdu en moyenne sur un trade perdant.
  // Un même 1R sert de référence stable pour le R global ET chaque mois
  // (voir riskUnit plus bas), pour rester comparable d'un mois à l'autre.
  const riskUnit = avgLoss ? Math.abs(avgLoss) : null

  return {
    total,
    netTotal,
    winRate: total ? (wins.length / total) * 100 : null,
    winCount: wins.length,
    profitFactor: grossLoss ? grossWin / grossLoss : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss,
    riskUnit,
    rTotal: riskUnit ? netTotal / riskUnit : null,
    best: trades.reduce((m, t) => (m === null || t.net > m.net ? t : m), null),
    worst: trades.reduce((m, t) => (m === null || t.net < m.net ? t : m), null),
  }
}

export function computeTodayNet(trades) {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000
  return trades.reduce((sum, t) => (t.closeTime >= startOfDay ? sum + t.net : sum), 0)
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

// Un trade dont le net (en % du capital de référence) reste dans cette
// bande autour de 0 est un BE (SL déplacé au breakeven par le trailing
// stop, touché sans gain ni perte significative) — ni un vrai TP, ni un
// vrai SL, peu importe ce que dit le champ `reason` de MT5 (peu fiable :
// une clôture manuelle ou via l'app tague CLIENT/EXPERT même quand elle a
// lieu pile au niveau du SL/TP).
const BE_BAND_PCT = 0.03

export function computeBreakdown(trades, accountSize) {
  let tp = 0
  let sl = 0
  let be = 0
  for (const t of trades) {
    const pct = accountSize ? (t.net / accountSize) * 100 : null
    if (pct !== null && Math.abs(pct) <= BE_BAND_PCT) be++
    else if (t.net >= 0) tp++
    else sl++
  }
  return { tp, sl, be, total: trades.length }
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

export function computeDailyNet(trades) {
  const byDay = new Map()
  for (const t of trades) {
    const d = new Date(t.closeTime * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    byDay.set(key, (byDay.get(key) ?? 0) + t.net)
  }
  return byDay
}

export function computeCurve(trades) {
  const chronological = [...trades].sort((a, b) => a.closeTime - b.closeTime)
  let cumulative = 0
  return chronological.map((t) => {
    cumulative += t.net
    return cumulative
  })
}

function shareOrDownload(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType })
  const file = new File([blob], filename, { type: mimeType })

  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Journal mymt5' }).catch(() => {})
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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
  shareOrDownload(header + rows, 'text/csv', 'journal.csv')
}

export function exportHtml(trades) {
  const netTotal = trades.reduce((sum, t) => sum + t.net, 0)
  const rows = trades
    .map((t) => {
      const netClass = t.net >= 0 ? 'pos' : 'neg'
      return `<tr>
        <td>${new Date(t.closeTime * 1000).toLocaleString('fr-FR')}</td>
        <td>${t.symbol}</td>
        <td>${t.type}</td>
        <td>${formatVolume(t.volume)}</td>
        <td>${t.priceOpen}</td>
        <td>${t.priceClose}</td>
        <td>${t.profit.toFixed(2)}</td>
        <td>${t.swap.toFixed(2)}</td>
        <td>${t.commission.toFixed(2)}</td>
        <td class="${netClass}">${money(t.net)}</td>
        <td>${t.reason}</td>
      </tr>`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>Journal mymt5</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0b0f1a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.meta { color: #94a3b8; font-size: 13px; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 16px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #1e293b; white-space: nowrap; }
  th { color: #94a3b8; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
  td.pos { color: #60a5fa; font-weight: 600; }
  td.neg { color: #f87171; font-weight: 600; }
</style>
</head>
<body>
  <h1>Journal mymt5</h1>
  <p class="meta">${trades.length} trades · Net total : ${money(netTotal)} · généré le ${new Date().toLocaleString('fr-FR')}</p>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Symbole</th><th>Type</th><th>Volume</th><th>Prix ouv.</th><th>Prix clôt.</th>
        <th>Profit</th><th>Swap</th><th>Commission</th><th>Net</th><th>Raison</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`

  shareOrDownload(html, 'text/html', 'journal.html')
}
