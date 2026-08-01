import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const ACTIONS = new Set(['BUY', 'SELL', 'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP'])

router.post('/:symbol/request', requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  const { action, volume, price, sl, tp, comment } = req.body ?? {}

  if (!ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Action invalide' })
  }
  if (typeof volume !== 'number' || volume <= 0) {
    return res.status(400).json({ error: 'Volume invalide' })
  }
  if (typeof price !== 'number' || price <= 0) {
    return res.status(400).json({ error: 'Prix invalide' })
  }

  const requestId = randomUUID()

  await db.collection('commands').doc('order_request').set({
    request_id: requestId,
    symbol,
    action,
    volume,
    price,
    sl: typeof sl === 'number' ? sl : null,
    tp: typeof tp === 'number' ? tp : null,
    comment: typeof comment === 'string' ? comment : 'app',
    status: 'pending',
    ts: Date.now(),
  })

  res.status(202).json({ requestId })
})

router.get('/:requestId', requireAuth, async (req, res) => {
  const doc = await db.collection('orders').doc(req.params.requestId).get()
  if (!doc.exists) {
    return res.status(404).json({ error: 'Résultat indisponible' })
  }

  const data = doc.data()
  res.json({
    ok: Boolean(data.ok),
    ticket: data.ticket ?? null,
    price: data.price ?? null,
    volume: data.volume ?? null,
    error: data.error ?? null,
    retcode: data.retcode ?? null,
    ts: data.ts ?? null,
  })
})

export default router
