import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

router.post('/subscribe', requireAuth, async (req, res) => {
  const subscription = req.body
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide' })
  }

  await db
    .collection('pushSubscriptions')
    .doc(req.userId)
    .set({ subscription, updatedAt: Date.now() })

  res.status(201).json({ ok: true })
})

router.delete('/subscribe', requireAuth, async (req, res) => {
  await db.collection('pushSubscriptions').doc(req.userId).delete()
  res.status(204).end()
})

export default router
