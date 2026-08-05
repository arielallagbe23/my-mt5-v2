import { MonthlyBars } from './MonthlyBars'

export function MonthlyPnlCard({ monthly }) {
  if (monthly.length === 0) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L mensuel</p>
      <MonthlyBars monthly={monthly} />
    </div>
  )
}
