import { PerformanceCurve } from './PerformanceCurve'
import { formatSignedPct, money } from './journalStats'

export function PerformanceCard({ netTotal, curve, unit, accountSize }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase mb-4">Courbe de performance</p>
        <span className={`text-sm font-bold ${netTotal >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
          {unit === 'pct' ? formatSignedPct((netTotal / accountSize) * 100) : money(netTotal)}
        </span>
      </div>
      <PerformanceCurve curve={curve} unit={unit} />
      <p className="mt-4 text-xs text-slate-500">
        P&amp;L cumulé {unit === 'pct' ? '· % du capital de base' : ', en dollars'}
      </p>
    </div>
  )
}
