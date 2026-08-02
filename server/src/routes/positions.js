import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

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
  res.json({
    orders: data.orders ?? [],
    positions: data.positions ?? [],
    ts: data.ts ?? null,
  })
})

export default router
