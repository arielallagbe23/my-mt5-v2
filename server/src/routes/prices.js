import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/:symbol/request', requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  await db.collection('commands').doc('price_request').set({
    symbol,
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: symbol })
})

router.get('/:symbol', requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  const doc = await db.collection('prices').doc(symbol).get()
  if (!doc.exists) {
    return res.status(404).json({ error: 'Prix indisponible' })
  }

  const data = doc.data()
  res.json({
    symbol,
    bid: data.bid ?? null,
    ask: data.ask ?? null,
    ts: data.ts ?? null,
  })
})

export default router
