import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const SCENARIOS = new Set(['buy', 'sell'])
const TIMEFRAMES = new Set(['M15', 'H1', 'H4'])
const MAX_RISK_PERCENT = 2 // garde-fou : jamais plus de 2% du capital risqué sur une tâche

function serialize(doc) {
  const data = doc.data()
  return {
    id: doc.id,
    scenario: data.scenario,
    scenarioId: data.scenarioId,
    fibo100: data.fibo100,
    fibo0: data.fibo0,
    timeframe: data.timeframe,
    executionTime: data.executionTime,
    priceCondition: data.priceCondition,
    supportPrice: data.supportPrice,
    risk: data.risk,
    status: data.status,
    result: data.result ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}

function validateTaskBody(body) {
  const { scenario, fibo100, fibo0, timeframe, executionTime, priceCondition, supportPrice, risk } = body ?? {}

  if (!SCENARIOS.has(scenario)) return 'Scénario invalide (buy ou sell)'
  if (!TIMEFRAMES.has(timeframe)) return 'Timeframe invalide (M15, H1 ou H4)'
  if (typeof executionTime !== 'string' || Number.isNaN(Date.parse(executionTime))) return 'Heure d\'exécution invalide'
  for (const [label, value] of [
    ['fibo100', fibo100],
    ['fibo0', fibo0],
    ['priceCondition', priceCondition],
    ['supportPrice', supportPrice],
    ['risk', risk],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `Champ ${label} invalide`
  }
  if (risk <= 0 || risk > MAX_RISK_PERCENT) return `Risque invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%)`
  return null
}

// Un brouillon peut avoir n'importe quel champ manquant (l'utilisateur n'a pas
// fini de le remplir) — on valide juste que ce qui EST rempli a le bon type,
// pour ne jamais enregistrer une valeur incohérente en base.
function validateDraftBody(body) {
  const { scenario, fibo100, fibo0, timeframe, executionTime, priceCondition, supportPrice, risk } = body ?? {}

  if (scenario != null && !SCENARIOS.has(scenario)) return 'Scénario invalide (buy ou sell)'
  if (timeframe != null && !TIMEFRAMES.has(timeframe)) return 'Timeframe invalide (M15, H1 ou H4)'
  if (executionTime != null && executionTime !== '' && Number.isNaN(Date.parse(executionTime))) {
    return 'Heure d\'exécution invalide'
  }
  for (const [label, value] of [
    ['fibo100', fibo100],
    ['fibo0', fibo0],
    ['priceCondition', priceCondition],
    ['supportPrice', supportPrice],
    ['risk', risk],
  ]) {
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) return `Champ ${label} invalide`
  }
  if (typeof risk === 'number' && (risk <= 0 || risk > MAX_RISK_PERCENT)) {
    return `Risque invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%)`
  }
  return null
}

router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('tasks').where('userId', '==', req.userId).get()
  const tasks = snapshot.docs.map(serialize).sort((a, b) => (a.executionTime > b.executionTime ? 1 : -1))
  res.json(tasks)
})

router.get('/:id', requireAuth, async (req, res) => {
  const doc = await db.collection('tasks').doc(req.params.id).get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    return res.status(404).json({ error: 'Tâche introuvable' })
  }
  res.json(serialize(doc))
})

router.post('/', requireAuth, async (req, res) => {
  const status = req.body?.status === 'draft' ? 'draft' : 'pending'
  const error = status === 'draft' ? validateDraftBody(req.body) : validateTaskBody(req.body)
  if (error) return res.status(400).json({ error })

  const { scenario, scenarioId, fibo100, fibo0, timeframe, executionTime, priceCondition, supportPrice, risk } =
    req.body

  const now = Date.now()
  const docRef = await db.collection('tasks').add({
    userId: req.userId,
    scenario: scenario ?? null,
    scenarioId: typeof scenarioId === 'string' ? scenarioId : null,
    fibo100: fibo100 ?? null,
    fibo0: fibo0 ?? null,
    timeframe: timeframe ?? null,
    executionTime: executionTime ?? null,
    priceCondition: priceCondition ?? null,
    supportPrice: supportPrice ?? null,
    risk: risk ?? null,
    status,
    result: null,
    createdAt: now,
    updatedAt: now,
  })

  const doc = await docRef.get()
  res.status(201).json(serialize(doc))
})

router.patch('/:id', requireAuth, async (req, res) => {
  const ref = db.collection('tasks').doc(req.params.id)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    return res.status(404).json({ error: 'Tâche introuvable' })
  }

  const status = req.body?.status === 'draft' ? 'draft' : 'pending'
  const merged = { ...doc.data(), ...req.body }
  const error = status === 'draft' ? validateDraftBody(merged) : validateTaskBody(merged)
  if (error) return res.status(400).json({ error })

  const { scenario, scenarioId, fibo100, fibo0, timeframe, executionTime, priceCondition, supportPrice, risk } =
    merged

  await ref.update({
    scenario: scenario ?? null,
    scenarioId: typeof scenarioId === 'string' ? scenarioId : null,
    fibo100: fibo100 ?? null,
    fibo0: fibo0 ?? null,
    timeframe: timeframe ?? null,
    executionTime: executionTime ?? null,
    priceCondition: priceCondition ?? null,
    supportPrice: supportPrice ?? null,
    risk: risk ?? null,
    status,
    updatedAt: Date.now(),
  })

  const updated = await ref.get()
  res.json(serialize(updated))
})

router.delete('/:id', requireAuth, async (req, res) => {
  const ref = db.collection('tasks').doc(req.params.id)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    return res.status(404).json({ error: 'Tâche introuvable' })
  }

  await ref.delete()
  res.status(204).end()
})

export default router
