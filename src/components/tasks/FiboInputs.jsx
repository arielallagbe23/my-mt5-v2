const COMPACT_INPUT =
  'min-h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white ' +
  'focus:outline-2 focus:outline-indigo-500 focus:outline-offset-1'

export function FiboInputs({ fibo100, fibo0, onFibo100Change, onFibo0Change, reversed = false }) {
  const field100 = (
    <label key="100" className="flex flex-col gap-1.5 text-xs text-slate-400">
      <div>Niveau 100%</div>
      <input
        type="number"
        inputMode="decimal"
        value={fibo100}
        onChange={(event) => onFibo100Change(event.target.value)}
        className={COMPACT_INPUT}
      />
    </label>
  )

  const field0 = (
    <label key="0" className="flex flex-col gap-1.5 text-xs text-slate-400">
      <div>Niveau 0%</div>
      <input
        type="number"
        inputMode="decimal"
        value={fibo0}
        onChange={(event) => onFibo0Change(event.target.value)}
        className={COMPACT_INPUT}
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-sm text-slate-500">Niveaux de Fibo</p>
      {reversed ? [field0, field100] : [field100, field0]}
    </div>
  )
}
