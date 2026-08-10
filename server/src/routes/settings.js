import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const MAX_RISK_PERCENT = 2 // même plafond que partout ailleurs dans l'app
const DEFAULT_RISK_SETTINGS = {
  mode: 'manual',
  tiers: [
    { threshold: 1, risk: 0.5 },
    { threshold: 2, risk: 1 },
  ],
  capRisk: 2,
}

function validateRiskSettings(body) {
  const { mode, tiers, capRisk } = body ?? {}

  if (mode !== 'manual' && mode !== 'auto') return 'Mode invalide (manual ou auto)'
  if (!Array.isArray(tiers) || tiers.length === 0) return 'Au moins un palier requis'

  let lastThreshold = 0
  for (const tier of tiers) {
    if (typeof tier.threshold !== 'number' || !Number.isFinite(tier.threshold) || tier.threshold <= lastThreshold) {
      return 'Les seuils doivent être des nombres croissants'
    }
    if (typeof tier.risk !== 'number' || !Number.isFinite(tier.risk) || tier.risk <= 0 || tier.risk > MAX_RISK_PERCENT) {
      return `Risque de palier invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%)`
    }
    lastThreshold = tier.threshold
  }

  if (typeof capRisk !== 'number' || !Number.isFinite(capRisk) || capRisk <= 0 || capRisk > MAX_RISK_PERCENT) {
    return `Plafond invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%)`
  }

  return null
}

router.get('/risk', requireAuth, async (req, res) => {
  const doc = await db.collection('settings').doc('risk').get()
  res.json(doc.exists ? doc.data() : DEFAULT_RISK_SETTINGS)
})

router.patch('/risk', requireAuth, async (req, res) => {
  const error = validateRiskSettings(req.body)
  if (error) return res.status(400).json({ error })

  const { mode, tiers, capRisk } = req.body
  const payload = { mode, tiers, capRisk, updatedAt: Date.now() }
  await db.collection('settings').doc('risk').set(payload)
  res.json(payload)
})

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
