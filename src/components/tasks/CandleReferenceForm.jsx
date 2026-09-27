import { FIELD_INPUT } from '../../lib/layout'

export function CandleReferenceForm({
  timeframe,
  onTimeframeChange,
  dateTime,
  onDateTimeChange,
  onSubmit,
  loading,
  error,
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Bougie de référence</p>

      <div className="mb-2 flex gap-2">
        {['M15', 'H1', 'H4'].map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => onTimeframeChange(tf)}
            className={`min-h-9 flex-1 rounded-sm text-sm font-semibold transition-colors ${
              timeframe === tf ? 'bg-amber-600 text-white' : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      <input
        type="datetime-local"
        value={dateTime}
        onChange={(event) => onDateTimeChange(event.target.value)}
        className={`${FIELD_INPUT} w-full min-w-0`}
      />

      <button
        type="button"
        onClick={onSubmit}
        disabled={loading}
        className="my-2 min-h-10 rounded-sm bg-amber-600 text-sm font-semibold text-white disabled:opacity-60"
      >
        {loading ? 'Récupération...' : 'Récupérer la bougie'}
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
