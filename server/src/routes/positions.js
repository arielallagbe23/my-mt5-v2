import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const MANAGEABLE_TIMEFRAMES = new Set(['H1', 'H4'])

router.post('/request', requireAuth, async (req, res) => {
  await db.collection('commands').doc('positions_request').set({
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/', requireAuth, async (req, res) => {
  const doc = await db.collection('positions').doc('main').get()
  if (!doc.exists) {
    return res.status(503).json({ error: 'Indisponible' })
  }

  const data = doc.data()
  const positions = data.positions ?? []

  const managedSnapshot = await db.collection('managed_positions').get()
  const managedTimeframeByTicket = new Map(managedSnapshot.docs.map((d) => [d.id, d.data().timeframe]))

  res.json({
    orders: data.orders ?? [],
    positions: positions.map((p) => ({
      ...p,
      managedTimeframe: managedTimeframeByTicket.get(String(p.ticket)) ?? null,
    })),
    ts: data.ts ?? null,
  })
})

// Active le suivi (trailing stop + progression TP) côté VPS pour une position
// qui n'a PAS été ouverte par une tâche mymt5 (ouverte manuellement, ou par
// un autre EA) — le VPS lit ce document en fallback quand le commentaire MT5
// de la position ne pointe vers aucune tâche connue.
router.post('/:ticket/activate-monitoring', requireAuth, async (req, res) => {
  const { timeframe } = req.body ?? {}
  if (!MANAGEABLE_TIMEFRAMES.has(timeframe)) {
    return res.status(400).json({ error: 'Timeframe invalide (H1 ou H4)' })
  }

  await db.collection('managed_positions').doc(req.params.ticket).set({
    timeframe,
    activatedAt: Date.now(),
  })
  res.status(201).json({ ticket: req.params.ticket, timeframe })
})

export default router
