import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const TIMEFRAMES = new Set(['M15', 'H1', 'H4'])

router.post('/:symbol/request', requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  const { timeframe, time } = req.body ?? {}

  if (!TIMEFRAMES.has(timeframe)) {
    return res.status(400).json({ error: 'Timeframe invalide (M15, H1 ou H4)' })
  }
  if (typeof time !== 'string' || Number.isNaN(Date.parse(time))) {
    return res.status(400).json({ error: 'Heure invalide' })
  }

  await db.collection('commands').doc('candle_request').set({
    symbol,
    timeframe,
    time,
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: symbol })
})

router.get('/:symbol', requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  const doc = await db.collection('candles').doc(symbol).get()
  if (!doc.exists) {
    return res.status(404).json({ error: 'Bougie indisponible' })
  }

  const data = doc.data()
  res.json({
    symbol,
    timeframe: data.timeframe ?? null,
    requestedTime: data.requested_time ?? null,
    candleTime: data.candle_time ?? null,
    open: data.open ?? null,
    high: data.high ?? null,
    low: data.low ?? null,
    close: data.close ?? null,
    volume: data.volume ?? null,
    ts: data.ts ?? null,
  })
})

export default router
