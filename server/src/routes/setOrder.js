import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const SIDES = new Set(['buy', 'sell'])
const ORDER_KINDS = new Set(['market', 'pending'])
const MAX_RISK_PERCENT = 2 // garde-fou : jamais plus de 2% du capital risqué sur un ordre

function validateSetOrderBody(body) {
  const { side, orderKind, entry, sl, tp, risk } = body ?? {}

  if (!SIDES.has(side)) return 'Sens invalide (buy ou sell)'
  if (!ORDER_KINDS.has(orderKind)) return 'Type invalide (market ou pending)'
  if (orderKind === 'pending' && (typeof entry !== 'number' || !Number.isFinite(entry))) {
    return "Prix d'entrée invalide"
  }
  if (typeof sl !== 'number' || !Number.isFinite(sl)) return 'SL invalide'
  if (tp != null && (typeof tp !== 'number' || !Number.isFinite(tp))) return 'TP invalide'
  if (typeof risk !== 'number' || !Number.isFinite(risk) || risk <= 0 || risk > MAX_RISK_PERCENT) {
    return `Risque invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%)`
  }
  return null
}

router.post('/request', requireAuth, async (req, res) => {
  const error = validateSetOrderBody(req.body)
  if (error) return res.status(400).json({ error })

  const { side, orderKind, entry, sl, tp, risk } = req.body

  await db.collection('commands').doc('set_order_request').set({
    status: 'pending',
    side,
    orderKind,
    entry: orderKind === 'pending' ? entry : null,
    sl,
    tp: tp ?? null,
    risk,
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/result', requireAuth, async (req, res) => {
  const doc = await db.collection('order_results').doc('main').get()
  if (!doc.exists) {
    return res.status(503).json({ error: 'Indisponible' })
  }
  res.json(doc.data())
})

export default router
