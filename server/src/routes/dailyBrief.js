import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

// Écrit uniquement par daily_brief.py côté VPS (accès Firestore direct via
// service-account.json) — cette route est en lecture seule pour le frontend.
// Un doc par checkpoint (dailyBrief/{date}/checkpoints/{checkpoint}) : le
// frontend reçoit un tableau et se charge de l'ordonner.
router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('dailyBrief').doc(todayKey()).collection('checkpoints').get()
  res.json(snapshot.docs.map((doc) => doc.data()))
})

export default router
