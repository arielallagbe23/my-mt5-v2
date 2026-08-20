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

  // Une position ouverte par une tâche mymt5 (commentaire MT5 "task-{id}")
  // est suivie (trailing stop + rapport) via le timeframe de SA tâche —
  // jamais via managed_positions (réservé à l'activation manuelle). Même
  // résolution que resolve_timeframe côté VPS (position_shared.py), pour
  // que le badge affiché à l'app corresponde exactement à ce qui tourne
  // réellement là-bas.
  const taskIdByTicket = new Map(
    positions
      .filter((p) => p.comment?.startsWith('task-'))
      .map((p) => [p.ticket, p.comment.slice('task-'.length)]),
  )
  const taskTimeframeById = new Map()
  if (taskIdByTicket.size > 0) {
    const entries = [...taskIdByTicket.values()]
    const taskDocs = await Promise.all(entries.map((id) => db.collection('tasks').doc(id).get()))
    taskDocs.forEach((taskDoc, i) => {
      if (taskDoc.exists) taskTimeframeById.set(entries[i], taskDoc.data().timeframe)
    })
  }

  res.json({
    orders: data.orders ?? [],
    positions: positions.map((p) => {
      const taskId = taskIdByTicket.get(p.ticket)
      const resolved = taskId ? taskTimeframeById.get(taskId) : managedTimeframeByTicket.get(String(p.ticket))
      return {
        ...p,
        managedTimeframe: MANAGEABLE_TIMEFRAMES.has(resolved) ? resolved : null,
      }
    }),
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
