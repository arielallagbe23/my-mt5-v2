import { Donut } from './Donut'

export function ResultsBreakdownCard({ breakdown }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Répartition des résultats</p>
      <Donut breakdown={breakdown} />
    </div>
  )
}
