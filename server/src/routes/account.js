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
// retoucher cette route à chaque compte ajouté. Fusionne aussi pseudo/
// riskMultiplier (account_settings/{vpsId}, propriété de l'app — jamais
// écrit par le VPS, contrairement à vps_status).
router.get('/all', requireAuth, async (req, res) => {
  const [statusSnapshot, settingsSnapshot] = await Promise.all([
    db.collection('vps_status').get(),
    db.collection('account_settings').get(),
  ])
  const settingsByVpsId = new Map(settingsSnapshot.docs.map((d) => [d.id, d.data()]))

  const result = {}
  for (const doc of statusSnapshot.docs) {
    const data = doc.data()
    const login = data.login ?? null
    const settings = settingsByVpsId.get(doc.id)
    result[doc.id] = {
      online: Boolean(data.online),
      login,
      equity: data.equity ?? null,
      currency: data.currency ?? null,
      server: data.server ?? null,
      ts: data.ts ?? null,
      accountSize: login != null ? ((data.accounts ?? {})[String(login)]?.account_size ?? null) : null,
      pseudo: settings?.pseudo ?? null,
      riskMultiplier: settings?.riskMultiplier ?? 1,
    }
  }
  res.json(result)
})

const MAX_RISK_MULTIPLIER = 5
const MAX_PSEUDO_LENGTH = 40

// Pseudo + multiplicateur de risque d'un compte — édité depuis la page "Mes
// comptes". Le multiplicateur n'affecte que le lot calculé du SUPPLÉANT
// concerné (voir compute_follower_lot dans mirror_follower.py) : x2 double
// le lot proratisé habituel, jamais le risque en % lui-même.
router.patch('/:vpsId/settings', requireAuth, async (req, res) => {
  const { pseudo, riskMultiplier } = req.body ?? {}

  if (pseudo != null && (typeof pseudo !== 'string' || pseudo.length > MAX_PSEUDO_LENGTH)) {
    return res.status(400).json({ error: `Pseudo invalide (max ${MAX_PSEUDO_LENGTH} caractères)` })
  }
  if (
    typeof riskMultiplier !== 'number' ||
    !Number.isFinite(riskMultiplier) ||
    riskMultiplier <= 0 ||
    riskMultiplier > MAX_RISK_MULTIPLIER
  ) {
    return res.status(400).json({ error: `Multiplicateur invalide (doit être entre 0 et ${MAX_RISK_MULTIPLIER})` })
  }

  const payload = { pseudo: pseudo?.trim() || null, riskMultiplier, updatedAt: Date.now() }
  await db.collection('account_settings').doc(req.params.vpsId).set(payload)
  res.json(payload)
})

export default router
