import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const DEFAULT_ALERT_SETTINGS = { h1: true, h4: true }

router.get('/alerts', requireAuth, async (req, res) => {
  const doc = await db.collection('settings').doc('alerts').get()
  res.json(doc.exists ? doc.data() : DEFAULT_ALERT_SETTINGS)
})

router.patch('/alerts', requireAuth, async (req, res) => {
  const { h1, h4 } = req.body ?? {}
  if (typeof h1 !== 'boolean' || typeof h4 !== 'boolean') {
    return res.status(400).json({ error: 'h1 et h4 doivent être des booléens' })
  }

  const payload = { h1, h4, updatedAt: Date.now() }
  await db.collection('settings').doc('alerts').set(payload)
  res.json(payload)
})

export default router
