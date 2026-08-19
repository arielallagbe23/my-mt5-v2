import { useEffect, useState } from 'react'

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
  riskMode = 'manual',
  growthPercent,
  onSaveDraft,
  onFinalize,
  saving,
  saveError,
  savedStatus,
}) {
  const [customRisk, setCustomRisk] = useState(risk !== '' && !RISK_PRESETS.includes(risk))
  const operator = scenario === 'sell' ? '<=' : '>='

  // Reprend un brouillon dont le risque a été rempli avant que ce composant
  // existe (donc après le calcul initial de customRisk au montage).
  useEffect(() => {
    setCustomRisk(risk !== '' && !RISK_PRESETS.includes(risk))
  }, [risk])

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/5 p-4">
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
        {riskMode === 'auto' ? (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-2">
            <p className="text-sm font-semibold text-white">{risk !== '' ? `${risk}%` : '—'} (auto)</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {typeof growthPercent === 'number'
                ? `Calculé depuis la croissance de l'équité (${growthPercent >= 0 ? '+' : ''}${growthPercent.toFixed(2)}%) — voir Paramètres.`
                : 'Calculé automatiquement — voir Paramètres.'}
            </p>
          </div>
        ) : (
          <>
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
                min="0"
                max="2"
                step="0.1"
                placeholder="Max 2%"
                value={risk}
                onChange={(event) => onRiskChange(event.target.value)}
                className={COMPACT_INPUT}
              />
            )}
          </>
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
          onClick={onSaveDraft}
          disabled={saving}
          className="min-h-14 flex-1 rounded-xl border border-white/10 bg-white/5 text-base font-semibold text-slate-300 disabled:opacity-60"
        >
          {saving ? '...' : 'Enregistrer comme brouillon'}
        </button>
        <button
          type="button"
          onClick={onFinalize}
          disabled={saving}
          className="min-h-14 flex-1 rounded-xl bg-indigo-600 text-base font-semibold text-white disabled:opacity-60"
        >
          {saving ? '...' : 'Confirmer la tâche'}
        </button>
      </div>

      {saveError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {saveError}
        </div>
      )}
      {savedStatus === 'draft' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-sm text-amber-400">
          Brouillon enregistré — tu peux revenir le terminer plus tard.
        </div>
      )}
      {savedStatus === 'pending' && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-center text-sm text-green-400">
          Tâche confirmée — elle s'exécutera automatiquement à l'heure prévue.
        </div>
      )}
    </div>
  )
}
