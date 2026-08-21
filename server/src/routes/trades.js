import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/sync', requireAuth, async (req, res) => {
  await db.collection('commands').doc('trades_sync_request').set({
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

const REQUIRED_FIELDS = ['positionId', 'symbol', 'type', 'volume', 'priceOpen', 'priceClose', 'net', 'openTime', 'closeTime']

function isValidTrade(t) {
  if (!t || typeof t !== 'object') return false
  for (const field of REQUIRED_FIELDS) {
    if (t[field] === undefined || t[field] === null) return false
  }
  return true
}

// Import manuel d'un historique exporté (vieux compte, terminal secondaire...
// voir src/components/journal/importCsv.js côté app pour le parsing). Écrit
// dans la MÊME collection que la synchronisation live (trades.py), mais
// jamais par-dessus un trade déjà présent — un ticket qui existe déjà est
// ignoré plutôt qu'écrasé, pour ne jamais abîmer une donnée synchronisée
// depuis MT5 avec une valeur réimportée à la main.
router.post('/import', requireAuth, async (req, res) => {
  const { trades } = req.body ?? {}
  if (!Array.isArray(trades) || trades.length === 0) {
    return res.status(400).json({ error: 'Aucun trade à importer' })
  }
  if (trades.length > 2000) {
    return res.status(400).json({ error: 'Trop de trades en un seul import (max 2000)' })
  }
  if (!trades.every(isValidTrade)) {
    return res.status(400).json({ error: 'Un ou plusieurs trades sont incomplets' })
  }

  let imported = 0
  let skipped = 0
  for (const trade of trades) {
    const ref = db.collection('trades').doc(String(trade.positionId))
    const existing = await ref.get()
    if (existing.exists) {
      skipped++
      continue
    }
    await ref.set(trade)
    imported++
  }

  res.json({ imported, skipped })
})

router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('trades').orderBy('closeTime', 'desc').get()
  const trades = snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      positionId: data.positionId,
      symbol: data.symbol,
      type: data.type,
      volume: data.volume,
      priceOpen: data.priceOpen,
      priceClose: data.priceClose,
      profit: data.profit,
      swap: data.swap,
      commission: data.commission,
      net: data.net,
      openTime: data.openTime,
      closeTime: data.closeTime,
      reason: data.reason,
      comment: data.comment,
    }
  })
  res.json({ trades, total: trades.length })
})

export default router
