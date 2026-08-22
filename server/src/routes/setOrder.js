import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const SIDES = new Set(['buy', 'sell'])
const ORDER_KINDS = new Set(['market', 'pending'])
const RISK_TYPES = new Set(['percent', 'amount'])
const MAX_RISK_PERCENT = 2 // garde-fou : jamais plus de 2% du capital risqué sur un ordre
const VPS_ID = process.env.MT5_VPS_ID ?? 'main'

// Même logique que tasks.js : le montant risqué en mode "amount" est
// plafonné au même 2% du capital que le mode %, juste exprimé en dollars.
// null si le VPS n'a encore rien publié — le VPS refait ce contrôle de
// façon indépendante à l'exécution (voir resolve_risk_amount/
// scheduled_orders.py) et refusera si lui non plus ne peut pas déterminer
// account_size.
async function fetchAccountSize() {
  const doc = await db.collection('vps_status').doc(VPS_ID).get()
  if (!doc.exists) return null
  const data = doc.data()
  if (data.login == null) return null
  return (data.accounts ?? {})[String(data.login)]?.account_size ?? null
}

function validateRisk(body) {
  const { riskType, risk, riskAmount } = body ?? {}
  if (riskType != null && !RISK_TYPES.has(riskType)) return 'Type de risque invalide (percent ou amount)'
  if (riskType === 'amount') {
    if (typeof riskAmount !== 'number' || !Number.isFinite(riskAmount) || riskAmount <= 0) {
      return 'Montant risqué invalide'
    }
  } else {
    if (typeof risk !== 'number' || !Number.isFinite(risk) || risk <= 0 || risk > MAX_RISK_PERCENT) {
      return `Risque invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%)`
    }
  }
  return null
}

async function validateRiskAmountCap(body) {
  const { riskType, riskAmount } = body ?? {}
  if (riskType !== 'amount' || typeof riskAmount !== 'number' || !Number.isFinite(riskAmount)) return null
  const accountSize = await fetchAccountSize()
  if (accountSize == null) return null
  const maxAmount = (MAX_RISK_PERCENT / 100) * accountSize
  if (riskAmount > maxAmount) {
    return `Montant risqué trop élevé (max ${maxAmount.toFixed(2)}$, soit ${MAX_RISK_PERCENT}% du capital)`
  }
  return null
}

function validateSetOrderBody(body) {
  const { side, orderKind, entry, sl, tp } = body ?? {}

  if (!SIDES.has(side)) return 'Sens invalide (buy ou sell)'
  if (!ORDER_KINDS.has(orderKind)) return 'Type invalide (market ou pending)'
  if (orderKind === 'pending' && (typeof entry !== 'number' || !Number.isFinite(entry))) {
    return "Prix d'entrée invalide"
  }
  if (typeof sl !== 'number' || !Number.isFinite(sl)) return 'SL invalide'
  if (tp != null && (typeof tp !== 'number' || !Number.isFinite(tp))) return 'TP invalide'
  return validateRisk(body)
}

router.post('/request', requireAuth, async (req, res) => {
  const error = validateSetOrderBody(req.body)
  if (error) return res.status(400).json({ error })
  const capError = await validateRiskAmountCap(req.body)
  if (capError) return res.status(400).json({ error: capError })

  const { side, orderKind, entry, sl, tp, riskType, risk, riskAmount } = req.body

  await db.collection('commands').doc('set_order_request').set({
    status: 'pending',
    side,
    orderKind,
    entry: orderKind === 'pending' ? entry : null,
    sl,
    tp: tp ?? null,
    riskType: riskType ?? 'percent',
    risk: risk ?? null,
    riskAmount: riskAmount ?? null,
    ts: Date.now(),
  })
  res.status(202).json({ requested: true })
})

router.get('/result', requireAuth, async (req, res) => {
  const doc = await db.collection('order_results').doc('main').get()
  if (!doc.exists) {
    return res.status(503).json({ error: 'Indisponible' })
  }
  res.json(doc.data())
})

// Ordre manuel programmé à une heure fixe (voir scheduled_orders.py côté
// VPS) — persiste dans scheduled_orders jusqu'à exécution, contrairement à
// /request ci-dessus qui est traité immédiatement (~10s) puis jeté.
function validateScheduleBody(body) {
  const { executionTime } = body ?? {}
  if (typeof executionTime !== 'string' || Number.isNaN(Date.parse(executionTime))) {
    return "Heure d'exécution invalide"
  }
  return validateSetOrderBody(body)
}

router.post('/schedule', requireAuth, async (req, res) => {
  const error = validateScheduleBody(req.body)
  if (error) return res.status(400).json({ error })
  const capError = await validateRiskAmountCap(req.body)
  if (capError) return res.status(400).json({ error: capError })

  const { side, orderKind, entry, sl, tp, riskType, risk, riskAmount, executionTime } = req.body

  const now = Date.now()
  const docRef = await db.collection('scheduled_orders').add({
    userId: req.userId,
    side,
    orderKind,
    entry: orderKind === 'pending' ? entry : null,
    sl,
    tp: tp ?? null,
    riskType: riskType ?? 'percent',
    risk: risk ?? null,
    riskAmount: riskAmount ?? null,
    executionTime,
    status: 'pending',
    result: null,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json({ id: docRef.id })
})

router.get('/scheduled', requireAuth, async (req, res) => {
  const snapshot = await db
    .collection('scheduled_orders')
    .where('userId', '==', req.userId)
    .where('status', '==', 'pending')
    .get()

  const orders = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.executionTime > b.executionTime ? 1 : -1))
  res.json(orders)
})

router.delete('/scheduled/:id', requireAuth, async (req, res) => {
  const ref = db.collection('scheduled_orders').doc(req.params.id)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    return res.status(404).json({ error: 'Ordre programmé introuvable' })
  }
  await ref.delete()
  res.status(204).end()
})

export default router
