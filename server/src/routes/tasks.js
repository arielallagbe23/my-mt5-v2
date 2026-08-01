import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const SCENARIOS = new Set(['buy', 'sell'])
const TIMEFRAMES = new Set(['M15', 'H1', 'H4'])

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
  const error = validateTaskBody(req.body)
  if (error) return res.status(400).json({ error })

  const { scenario, scenarioId, fibo100, fibo0, timeframe, executionTime, priceCondition, supportPrice, risk } =
    req.body

  const now = Date.now()
  const docRef = await db.collection('tasks').add({
    userId: req.userId,
    scenario,
    scenarioId: typeof scenarioId === 'string' ? scenarioId : null,
    fibo100,
    fibo0,
    timeframe,
    executionTime,
    priceCondition,
    supportPrice,
    risk,
    status: 'pending',
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

  const error = validateTaskBody({ ...doc.data(), ...req.body })
  if (error) return res.status(400).json({ error })

  const { scenario, scenarioId, fibo100, fibo0, timeframe, executionTime, priceCondition, supportPrice, risk } =
    req.body

  await ref.update({
    scenario,
    scenarioId: typeof scenarioId === 'string' ? scenarioId : null,
    fibo100,
    fibo0,
    timeframe,
    executionTime,
    priceCondition,
    supportPrice,
    risk,
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
