import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const VPS_ID = process.env.MT5_VPS_ID ?? 'main'

router.post('/status/request', requireAuth, async (req, res) => {
  await db.collection('commands').doc('status_request').set({
    status: 'pending',
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/status', requireAuth, async (req, res) => {
  const doc = await db.collection('vps_status').doc(VPS_ID).get()
  if (!doc.exists) {
    return res.status(503).json({ online: false, error: 'VPS non connecté' })
  }

  const data = doc.data()
  res.json({
    online: Boolean(data.online),
    equity: data.equity ?? null,
    margin: data.margin ?? null,
    freeMargin: data.free_margin ?? null,
    currency: data.currency ?? null,
    login: data.login ?? null,
    server: data.server ?? null,
    ts: data.ts ?? null,
    accounts: data.accounts ?? {},
  })
})

// Toute la collection vps_status (un doc par compte MT5 — "main", "account2",
// et tout futur suppléant), pour la page "Mes comptes". Renvoie l'account_size
// du login actuellement connecté sur chaque doc, déjà déplié — pas besoin de
// retoucher cette route à chaque compte ajouté.
router.get('/all', requireAuth, async (req, res) => {
  const snapshot = await db.collection('vps_status').get()
  const result = {}
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const login = data.login ?? null
    result[doc.id] = {
      online: Boolean(data.online),
      login,
      equity: data.equity ?? null,
      currency: data.currency ?? null,
      server: data.server ?? null,
      ts: data.ts ?? null,
      accountSize: login != null ? ((data.accounts ?? {})[String(login)]?.account_size ?? null) : null,
    }
  }
  res.json(result)
})

export default router
