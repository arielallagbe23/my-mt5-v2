const BUY_PALE = 'bg-emerald-500/15 text-emerald-300'
const BUY_ACTIVE = 'bg-emerald-600 text-white'
const SELL_PALE = 'bg-red-500/15 text-red-300'
const SELL_ACTIVE = 'bg-red-600 text-white'

export function ScenarioToggle({ scenario, onToggle }) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onToggle('buy')}
        className={`min-h-10 flex-1 rounded-sm text-sm font-semibold transition-colors ${
          scenario === 'buy' ? BUY_ACTIVE : BUY_PALE
        }`}
      >
        Acheter
      </button>
      <button
        type="button"
        onClick={() => onToggle('sell')}
        className={`min-h-10 flex-1 rounded-sm text-sm font-semibold transition-colors ${
          scenario === 'sell' ? SELL_ACTIVE : SELL_PALE
        }`}
      >
        Vendre
      </button>
    </div>
  )
}
