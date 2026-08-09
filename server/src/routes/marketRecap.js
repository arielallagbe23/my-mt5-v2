import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Écrit uniquement par les scripts mt5-vps/0N_*.py (accès Firestore direct
// via service-account.json) — cette route est en lecture seule pour le frontend.
// Renvoie toute la collection (une entrée par "question"), indexée par ID de
// doc, pour ne pas avoir à retoucher la route à chaque script ajouté.
router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('daily_questions').get()
  const result = {}
  for (const doc of snapshot.docs) {
    const data = doc.data()
    result[doc.id] = {
      ...data,
      updated_at: data.updated_at?.toDate?.().toISOString() ?? null,
    }
  }
  res.json(result)
})

export default router
