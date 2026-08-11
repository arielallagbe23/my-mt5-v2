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

// Relance manuellement les 9 scripts VPS qui alimentent le Market Recap —
// pour le cas où la tâche planifiée du matin n'est pas passée. Le VPS
// (on_demand.py, handler market_recap_request) marque "done" une fois les 9
// scripts terminés (généralement moins d'une minute), pas à la réception.
router.post('/request', requireAuth, async (req, res) => {
  await db.collection('commands').doc('market_recap_request').set({
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/request/status', requireAuth, async (req, res) => {
  const doc = await db.collection('commands').doc('market_recap_request').get()
  if (!doc.exists) return res.json({ status: null, failed: [], ts: null })

  const data = doc.data()
  res.json({
    status: data.status ?? null,
    failed: data.failed ?? [],
    ts: data.completed_at ?? null,
  })
})

export default router
