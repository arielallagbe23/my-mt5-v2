import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'
import { TONE_CLASSES, EDGE_PADDING, computeFiboLevels } from '../lib/fibo'
import { ScenarioToggle } from '../components/tasks/ScenarioToggle'
import { FiboInputs } from '../components/tasks/FiboInputs'
import { CandleReferenceForm } from '../components/tasks/CandleReferenceForm'
import { CandleTable } from '../components/tasks/CandleTable'
import { FiboChart } from '../components/tasks/FiboChart'
import { TaskLauncher } from '../components/tasks/TaskLauncher'

const MIN_LABEL_GAP = 4 // % minimum entre deux libellés pour éviter le chevauchement

// Un seul scénario par sens pour le moment — l'évaluation réelle tourne côté VPS
// (Python) au moment de l'exécution, pas ici. Cet id sert juste à enregistrer
// quel scénario a été choisi.
const SCENARIO_IDS = { buy: null, sell: 'sell-1' }
const MAX_RISK_PERCENT = 2 // garde-fou : jamais plus de 2% du capital risqué sur une tâche

export function TasksPage({ taskId } = {}) {
  const [fibo100, setFibo100] = useState('')
  const [fibo0, setFibo0] = useState('')
  const [priceLoading, setPriceLoading] = useState(!taskId)
  const [scenario, setScenario] = useState(null)

  const [timeframe, setTimeframe] = useState('H1')
  const [candleDateTime, setCandleDateTime] = useState('')
  const [candle, setCandle] = useState(null)
  const [candleLoading, setCandleLoading] = useState(false)
  const [candleError, setCandleError] = useState('')

  const [executionTime, setExecutionTime] = useState('')
  const [priceCondition, setPriceCondition] = useState('')
  const [supportPrice, setSupportPrice] = useState('')
  const [risk, setRisk] = useState('')
  const [accountSize, setAccountSize] = useState(null)
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskSaveError, setTaskSaveError] = useState('')
  const [taskSavedStatus, setTaskSavedStatus] = useState(null)

  // Tâche en cours d'édition : null tant qu'aucun brouillon n'a encore été
  // enregistré (le premier "Enregistrer comme brouillon" crée la tâche et
  // remplit cet id, les suivants la mettent à jour au lieu d'en recréer une).
  const [currentTaskId, setCurrentTaskId] = useState(taskId ?? null)
  const [loadingTask, setLoadingTask] = useState(!!taskId)

  // Reprise d'un brouillon existant : on charge ses valeurs telles quelles,
  // sans toucher au prix live (voir l'effet suivant, qui se désactive dans ce cas).
  // Si on repart sur une tâche neuve (taskId redevient null sans que ce
  // composant soit démonté — ex: navigation depuis le menu après édition
  // d'un brouillon), on réinitialise le formulaire au lieu de laisser
  // traîner les valeurs de l'ancien brouillon.
  useEffect(() => {
    if (!taskId) {
      setCurrentTaskId(null)
      setScenario(null)
      setFibo100('')
      setFibo0('')
      setTimeframe('H1')
      setExecutionTime('')
      setPriceCondition('')
      setSupportPrice('')
      setRisk('')
      setCandle(null)
      setCandleDateTime('')
      setLoadingTask(false)
      return
    }
    let cancelled = false
    setLoadingTask(true)
    api
      .getTask(taskId)
      .then((task) => {
        if (cancelled) return
        setScenario(task.scenario ?? null)
        setFibo100(task.fibo100 != null ? String(task.fibo100) : '')
        setFibo0(task.fibo0 != null ? String(task.fibo0) : '')
        setTimeframe(task.timeframe ?? 'H1')
        setExecutionTime(task.executionTime ? task.executionTime.slice(0, 16) : '')
        setPriceCondition(task.priceCondition != null ? String(task.priceCondition) : '')
        setSupportPrice(task.supportPrice != null ? String(task.supportPrice) : '')
        setRisk(task.risk != null ? String(task.risk) : '')
        setCurrentTaskId(task.id)
      })
      .catch(() => setTaskSaveError('Impossible de charger le brouillon'))
      .finally(() => {
        if (!cancelled) setLoadingTask(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  useEffect(() => {
    if (taskId) return // reprise d'un brouillon : ne pas écraser ses valeurs avec le prix live
    let cancelled = false
    setPriceLoading(true)

    requestAndPoll({
      request: () => api.requestPrice('USDJPY'),
      fetch: () => api.price('USDJPY'),
      isFresh: isFreshTs,
      isCancelled: () => cancelled,
    }).then((data) => {
      if (cancelled) return
      if (data && typeof data.bid === 'number' && typeof data.ask === 'number') {
        const mid = ((data.bid + data.ask) / 2).toFixed(3)
        setFibo100(mid)
        setFibo0(mid)
        setPriceCondition(mid)
        setSupportPrice(mid)
      }
      setPriceLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [taskId])

  useEffect(() => {
    api
      .accountStatus()
      .then((data) => {
        const size = data.accounts?.[String(data.login)]?.account_size
        if (typeof size === 'number') setAccountSize(size)
      })
      .catch(() => {})
  }, [])

  const levels = scenario ? computeFiboLevels(parseFloat(fibo100), parseFloat(fibo0)) : null

  // Fibo 2 : 100% = 0% du Fibo 1, 0% = high (achat) ou low (vente) de la bougie de référence
  const candleBound = scenario === 'buy' ? candle?.high : scenario === 'sell' ? candle?.low : null
  const levels2 =
    scenario && typeof candleBound === 'number' ? computeFiboLevels(parseFloat(fibo0), candleBound) : null

  const taggedLevels1 = levels ? levels.map((l) => ({ ...l, fibo: 1 })) : null
  const taggedLevels2 = levels2 ? levels2.map((l) => ({ ...l, fibo: 2 })) : null
  const allLevels = taggedLevels1 ? (taggedLevels2 ? [...taggedLevels1, ...taggedLevels2] : taggedLevels1) : null
  const priceMax = allLevels ? Math.max(...allLevels.map((l) => l.price)) : null
  const priceMin = allLevels ? Math.min(...allLevels.map((l) => l.price)) : null
  const priceRange = priceMax !== null ? priceMax - priceMin : null

  function pricePosition(price) {
    if (!priceRange) return 50
    return EDGE_PADDING + ((priceMax - price) / priceRange) * (100 - 2 * EDGE_PADDING)
  }

  // Lignes : restent à leur position exacte, proportionnelle au prix réel.
  const linePositions = allLevels
    ? allLevels.map(({ level, fibo, tone, price }) => ({
        key: `${fibo}-${level}`,
        lineClass: TONE_CLASSES[tone].line,
        pos: pricePosition(price),
      }))
    : []

  // Libellés (texte) : espacés d'un minimum pour éviter le chevauchement, puis
  // recalés proportionnellement si besoin pour rester dans la boîte.
  const labelPositions = (() => {
    if (!allLevels) return []
    const sorted = allLevels
      .map(({ level, fibo, tone, price }) => ({
        key: `${fibo}-${level}`,
        textClass: TONE_CLASSES[tone].text,
        percentLabel: `${(level * 100).toFixed(1).replace(/\.0$/, '')}%`,
        priceLabel: price.toFixed(3),
        pos: pricePosition(price),
      }))
      .sort((a, b) => a.pos - b.pos)

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].pos - sorted[i - 1].pos < MIN_LABEL_GAP) {
        sorted[i].pos = sorted[i - 1].pos + MIN_LABEL_GAP
      }
    }

    const maxAllowed = 100 - EDGE_PADDING
    const lastPos = sorted[sorted.length - 1]?.pos
    if (lastPos > maxAllowed) {
      const scale = (maxAllowed - EDGE_PADDING) / (lastPos - EDGE_PADDING)
      for (const item of sorted) {
        item.pos = EDGE_PADDING + (item.pos - EDGE_PADDING) * scale
      }
    }

    return sorted
  })()

  const fibo236Prices = (() => {
    if (!levels || !levels2) return null
    const price1 = levels.find((l) => l.level === 0.236)?.price
    const price2 = levels2.find((l) => l.level === 0.236)?.price
    if (price1 == null || price2 == null) return null
    return { price1, price2 }
  })()

  const highlightZone = (() => {
    if (!fibo236Prices) return null
    const posA = pricePosition(fibo236Prices.price1)
    const posB = pricePosition(fibo236Prices.price2)
    return { top: Math.min(posA, posB), height: Math.abs(posA - posB) }
  })()

  const fibo236Bounds = fibo236Prices
    ? {
        low: Math.min(fibo236Prices.price1, fibo236Prices.price2),
        high: Math.max(fibo236Prices.price1, fibo236Prices.price2),
      }
    : null

  const riskPercent = parseFloat(risk)
  const riskAmount =
    accountSize != null && Number.isFinite(riskPercent) ? (riskPercent / 100) * accountSize : null

  function toggleScenario(next) {
    setScenario((current) => (current === next ? null : next))
  }

  function buildPayload() {
    const parsedFibo100 = parseFloat(fibo100)
    const parsedFibo0 = parseFloat(fibo0)
    const parsedPriceCondition = parseFloat(priceCondition)
    const parsedSupportPrice = parseFloat(supportPrice)
    const parsedRisk = parseFloat(risk)

    return {
      scenario: scenario ?? null,
      scenarioId: (scenario && SCENARIO_IDS[scenario]) ?? null,
      fibo100: Number.isFinite(parsedFibo100) ? parsedFibo100 : null,
      fibo0: Number.isFinite(parsedFibo0) ? parsedFibo0 : null,
      timeframe: timeframe || null,
      executionTime: executionTime ? `${executionTime}:00` : null,
      priceCondition: Number.isFinite(parsedPriceCondition) ? parsedPriceCondition : null,
      supportPrice: Number.isFinite(parsedSupportPrice) ? parsedSupportPrice : null,
      risk: Number.isFinite(parsedRisk) ? parsedRisk : null,
    }
  }

  async function persist(payload) {
    setTaskSaving(true)
    try {
      if (currentTaskId) {
        await api.updateTask(currentTaskId, payload)
      } else {
        const created = await api.createTask(payload)
        setCurrentTaskId(created.id)
      }
      setTaskSavedStatus(payload.status)
    } catch (err) {
      setTaskSaveError(err.message)
    } finally {
      setTaskSaving(false)
    }
  }

  // Enregistre l'état actuel du formulaire tel quel, même incomplet — pour
  // pouvoir revenir le terminer plus tard. Aucune tâche "brouillon" n'est
  // jamais scannée/exécutée côté VPS (qui ne regarde que status=="pending").
  async function saveDraft() {
    setTaskSaveError('')
    setTaskSavedStatus(null)
    await persist({ ...buildPayload(), status: 'draft' })
  }

  // Valide tous les champs requis puis passe la tâche en "pending" — c'est
  // seulement à partir de là qu'elle sera scannée et exécutée par le VPS.
  async function finalizeTask() {
    setTaskSaveError('')
    setTaskSavedStatus(null)

    if (!scenario) {
      setTaskSaveError('Choisis Acheter ou Vendre.')
      return
    }
    if (!executionTime) {
      setTaskSaveError("Renseigne l'heure d'exécution.")
      return
    }

    const payload = { ...buildPayload(), status: 'pending' }

    if ([payload.fibo100, payload.fibo0, payload.priceCondition, payload.supportPrice, payload.risk].includes(null)) {
      setTaskSaveError('Remplis tous les champs (Fibo, prix, risque) avant d\'enregistrer.')
      return
    }
    if (payload.risk <= 0 || payload.risk > MAX_RISK_PERCENT) {
      setTaskSaveError(`Risque invalide (doit être entre 0 et ${MAX_RISK_PERCENT}%).`)
      return
    }

    await persist(payload)
  }

  async function fetchCandleClose() {
    if (!candleDateTime) {
      setCandleError('Choisis une date et une heure')
      return
    }
    setCandleError('')
    setCandle(null)
    setCandleLoading(true)

    const isoTime = `${candleDateTime}:00`

    const data = await requestAndPoll({
      request: () => api.requestCandle('USDJPY', timeframe, isoTime),
      fetch: () => api.candle('USDJPY'),
      isFresh: isFreshTs,
    })

    setCandleLoading(false)
    if (data && typeof data.close === 'number') {
      setCandle(data)
    } else {
      setCandleError('Bougie introuvable')
    }
  }

  return (
    <div className={PAGE}>
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold text-white">USDJPY</div>
        {priceLoading && <span className="text-sm text-slate-400">Récupération du prix...</span>}
        {loadingTask && <span className="text-sm text-slate-400">Chargement du brouillon...</span>}
      </div>

      <ScenarioToggle scenario={scenario} onToggle={toggleScenario} />

      <FiboInputs
        fibo100={fibo100}
        fibo0={fibo0}
        onFibo100Change={setFibo100}
        onFibo0Change={setFibo0}
        reversed={scenario === 'sell'}
      />

      <CandleReferenceForm
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        dateTime={candleDateTime}
        onDateTimeChange={setCandleDateTime}
        onSubmit={fetchCandleClose}
        loading={candleLoading}
        error={candleError}
      />

      <CandleTable candle={candle} />

      <FiboChart linePositions={linePositions} labelPositions={labelPositions} highlightZone={highlightZone} />

      {fibo236Bounds && (
        <div className="flex justify-center gap-4 text-sm text-slate-400">
          <span>
            Borne basse : <span className="font-semibold text-amber-400">{fibo236Bounds.low.toFixed(3)}</span>
          </span>
          <span>
            Borne haute : <span className="font-semibold text-amber-400">{fibo236Bounds.high.toFixed(3)}</span>
          </span>
        </div>
      )}

      <TaskLauncher
        scenario={scenario}
        executionTime={executionTime}
        onExecutionTimeChange={setExecutionTime}
        priceCondition={priceCondition}
        onPriceConditionChange={setPriceCondition}
        supportPrice={supportPrice}
        onSupportPriceChange={setSupportPrice}
        risk={risk}
        onRiskChange={setRisk}
        riskAmount={riskAmount}
        onSaveDraft={saveDraft}
        onFinalize={finalizeTask}
        saving={taskSaving}
        saveError={taskSaveError}
        savedStatus={taskSavedStatus}
      />
    </div>
  )
}
