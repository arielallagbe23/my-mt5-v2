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
