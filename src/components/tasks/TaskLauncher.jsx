import { useState } from 'react'

const COMPACT_INPUT =
  'min-h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white ' +
  'focus:outline-2 focus:outline-indigo-500 focus:outline-offset-1'

const RISK_PRESETS = ['0.5', '1', '1.5', '2']

export function TaskLauncher({
  scenario,
  executionTime,
  onExecutionTimeChange,
  priceCondition,
  onPriceConditionChange,
  supportPrice,
  onSupportPriceChange,
  risk,
  onRiskChange,
  riskAmount,
  onActivate,
  result,
  onSave,
  saving,
  saveError,
  saved,
}) {
  const [customRisk, setCustomRisk] = useState(risk !== '' && !RISK_PRESETS.includes(risk))
  const operator = scenario === 'sell' ? '<=' : '>='

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Démarrer une tâche</p>

      <label className="flex flex-col gap-1.5 text-xs text-slate-400">
        <div>Heure d'exécution</div>
        <input
          type="datetime-local"
          value={executionTime}
          onChange={(event) => onExecutionTimeChange(event.target.value)}
          className={COMPACT_INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-xs text-slate-400">
        <div>
          Si close de la bougie <span className="font-semibold text-white">{operator}</span>
        </div>
        <input
          type="number"
          inputMode="decimal"
          value={priceCondition}
          onChange={(event) => onPriceConditionChange(event.target.value)}
          className={COMPACT_INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-xs text-slate-400">
        <div>Prix support intéressant</div>
        <input
          type="number"
          inputMode="decimal"
          value={supportPrice}
          onChange={(event) => onSupportPriceChange(event.target.value)}
          className={COMPACT_INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-xs text-slate-400">
        <div>Risque</div>
        <div className="flex gap-2">
          {RISK_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onRiskChange(preset)
                setCustomRisk(false)
              }}
              className={`min-h-9 flex-1 rounded-xl text-sm font-semibold transition-colors ${
                !customRisk && risk === preset ? 'bg-indigo-600 text-white' : 'bg-indigo-500/15 text-indigo-300'
              }`}
            >
              {preset}%
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustomRisk(true)}
            className={`min-h-9 flex-1 rounded-xl text-sm font-semibold transition-colors ${
              customRisk ? 'bg-indigo-600 text-white' : 'bg-indigo-500/15 text-indigo-300'
            }`}
          >
            Autre
          </button>
        </div>
        {customRisk && (
          <input
            type="number"
            inputMode="decimal"
            placeholder="Ex: 3"
            value={risk}
            onChange={(event) => onRiskChange(event.target.value)}
            className={COMPACT_INPUT}
          />
        )}
        {riskAmount !== null && (
          <p className="text-xs text-slate-400">
            Montant risqué : <span className="font-semibold text-white">{riskAmount.toFixed(2)}</span>
          </p>
        )}
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onActivate}
          className="min-h-10 flex-1 rounded-xl bg-indigo-500/15 text-sm font-semibold text-indigo-300"
        >
          Tester maintenant
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="min-h-10 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer la tâche'}
        </button>
      </div>

      {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      {saved && <p className="text-sm text-green-400">Tâche enregistrée.</p>}

      {result && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            result.matched
              ? 'border-green-500/30 bg-green-500/10 text-green-300'
              : 'border-white/10 bg-white/5 text-slate-400'
          }`}
        >
          {result.matched ? (
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Condition remplie — {result.orderType}</p>
              <p>Entrée : {result.entry}</p>
              <p>SL : {result.sl}</p>
              <p>TP : {result.tp}</p>
              <p>Lot : {result.lot}</p>
            </div>
          ) : (
            <p>{result.reason}</p>
          )}
        </div>
      )}
    </div>
  )
}
