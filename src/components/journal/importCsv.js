// Parse un export d'historique MT5 (Historique > clic droit > Exporter vers
// CSV) vers la même forme que les trades synchronisés en live (trades.py).
// On lit par POSITION de colonne, jamais par nom d'en-tête : l'en-tête MT5
// répète "Prix" deux fois (ouverture ET clôture) et son export peut arriver
// dans un encodage bancal ("DurÃ©e..."), donc s'appuyer sur le nom serait
// fragile — l'ordre des colonnes, lui, est stable.
//
// Colonnes attendues (dans l'ordre) :
// Ticket, Ouvrir, Type, Volume, Symbole, Prix, SL, TP, Fermeture, Prix,
// Swap, Commissions, Profit, Pips, Durée
//
// Limite connue : les dates de l'export sont dans le fuseau du TERMINAL au
// moment de l'export (souvent l'heure serveur du broker), pas en UTC réel —
// contrairement aux trades synchronisés en live (deal.time, vrai epoch
// UTC). Pas de décalage connu pour corriger ça après coup, donc les heures
// affichées pour les trades importés peuvent différer de quelques heures de
// la réalité (rarement plus d'une journée de bascule).

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

export function parseTradeHistoryCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const trades = []
  let skipped = 0

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    if (cells.length < 15) {
      skipped++
      continue
    }
    const [ticket, openTimeStr, type, volume, symbol, priceOpen, , , closeTimeStr, priceClose, swap, commission, profit] = cells

    const openTime = Math.floor(new Date(openTimeStr.trim().replace(' ', 'T')).getTime() / 1000)
    const closeTime = Math.floor(new Date(closeTimeStr.trim().replace(' ', 'T')).getTime() / 1000)
    const volumeNum = parseFloat(volume)
    const priceOpenNum = parseFloat(priceOpen)
    const priceCloseNum = parseFloat(priceClose)

    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime) || !Number.isFinite(volumeNum)) {
      skipped++
      continue
    }

    const swapNum = parseFloat(swap) || 0
    const commissionNum = parseFloat(commission) || 0
    const profitNum = parseFloat(profit) || 0

    trades.push({
      positionId: ticket.trim(),
      symbol: symbol.trim(),
      type: type.trim().toLowerCase() === 'buy' ? 'Buy' : 'Sell',
      volume: volumeNum,
      priceOpen: priceOpenNum,
      priceClose: priceCloseNum,
      profit: profitNum,
      swap: swapNum,
      commission: commissionNum,
      net: profitNum + swapNum + commissionNum,
      openTime,
      closeTime,
      reason: 'IMPORT',
      comment: 'imported-csv',
    })
  }

  return { trades, skipped }
}
