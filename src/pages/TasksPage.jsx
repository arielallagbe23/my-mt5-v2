import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE } from '../lib/layout'
import { requestAndPoll, isFreshTs } from '../lib/onDemand'
import { TONE_CLASSES, EDGE_PADDING, computeFiboLevels } from '../lib/fibo'
import { SCENARIOS } from '../lib/scenarios'
import { ScenarioToggle } from '../components/tasks/ScenarioToggle'
import { FiboInputs } from '../components/tasks/FiboInputs'
import { CandleReferenceForm } from '../components/tasks/CandleReferenceForm'
import { CandleTable } from '../components/tasks/CandleTable'
import { FiboChart } from '../components/tasks/FiboChart'
import { TaskLauncher } from '../components/tasks/TaskLauncher'

const MIN_LABEL_GAP = 4 // % minimum entre deux libellés pour éviter le chevauchement

export function TasksPage() {
  const [fibo100, setFibo100] = useState('')
  const [fibo0, setFibo0] = useState('')
  const [priceLoading, setPriceLoading] = useState(true)
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
  const [taskResult, setTaskResult] = useState(null)
  const [accountSize, setAccountSize] = useState(null)
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskSaveError, setTaskSaveError] = useState('')
  const [taskSaved, setTaskSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

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
  }, [])

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

  // Niveaux utilisés par les scénarios de tâche
  const sl1 = levels2?.find((l) => l.level === 0.8)?.price ?? null // 80% du Fibo 2
  const sl2 = levels?.find((l) => l.level === -0.05)?.price ?? null // -5% du Fibo 1
  const tp1 = levels?.find((l) => l.level === 0.588)?.price ?? null // 58,8% du Fibo 1
  const tp2 = levels?.find((l) => l.level === 0.975)?.price ?? null // 97,5% du Fibo 1

  const riskPercent = parseFloat(risk)
  const riskAmount =
    accountSize != null && Number.isFinite(riskPercent) ? (riskPercent / 100) * accountSize : null

  // Un seul scénario par sens pour le moment (le premier de la liste) — un sélecteur
  // sera ajouté dès qu'il y en aura plusieurs par sens.
  const activeScenario = scenario ? SCENARIOS[scenario]?.[0] : null

  function toggleScenario(next) {
    setScenario((current) => (current === next ? null : next))
  }

  function activateTask() {
    if (!activeScenario) {
      setTaskResult({ matched: false, reason: 'Aucun scénario disponible pour ce sens pour le moment.' })
      return
    }

    const result = activeScenario.evaluate({
      candle,
      fibo236Bounds,
      priceCondition,
      supportPrice,
      sl1,
      sl2,
      tp1,
      tp2,
      riskAmount,
    })

    setTaskResult(result)
  }

  async function saveTask() {
    setTaskSaveError('')
    setTaskSaved(false)

    if (!scenario) {
      setTaskSaveError('Choisis Acheter ou Vendre.')
      return
    }
    if (!executionTime) {
      setTaskSaveError("Renseigne l'heure d'exécution.")
      return
    }

    const payload = {
      scenario,
      scenarioId: activeScenario?.id ?? null,
      fibo100: parseFloat(fibo100),
      fibo0: parseFloat(fibo0),
      timeframe,
      executionTime: `${executionTime}:00`,
      priceCondition: parseFloat(priceCondition),
      supportPrice: parseFloat(supportPrice),
      risk: parseFloat(risk),
    }

    if (Object.values(payload).some((v) => typeof v === 'number' && !Number.isFinite(v))) {
      setTaskSaveError('Remplis tous les champs (Fibo, prix, risque) avant d\'enregistrer.')
      return
    }

    setTaskSaving(true)
    try {
      await api.createTask(payload)
      setTaskSaved(true)
    } catch (err) {
      setTaskSaveError(err.message)
    } finally {
      setTaskSaving(false)
    }
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
        onActivate={activateTask}
        result={taskResult}
        onSave={saveTask}
        saving={taskSaving}
        saveError={taskSaveError}
        saved={taskSaved}
      />
    </div>
  )
}
