import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('execution_reports').where('userId', '==', req.userId).get()
  const reports = snapshot.docs
    .map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        taskId: data.taskId,
        scenario: data.scenario,
        timeframe: data.timeframe,
        executionTime: data.executionTime,
        reason: data.reason,
        archived: Boolean(data.archived),
        createdAt: data.createdAt,
      }
    })
    .filter((r) => !r.archived)
    .sort((a, b) => b.createdAt - a.createdAt)

  res.json(reports)
})

router.post('/:id/archive', requireAuth, async (req, res) => {
  const ref = db.collection('execution_reports').doc(req.params.id)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    return res.status(404).json({ error: 'Rapport introuvable' })
  }

  await ref.update({ archived: true })
  res.status(204).end()
})

export default router
