import { money } from './journalStats'

export function BestWorstStreakCard({ kpis, streak }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between border-b border-white/10 py-2">
        <span className="text-xs text-slate-400 uppercase">Meilleur trade</span>
        <span className="text-sm font-semibold text-blue-400">{kpis.best ? money(kpis.best.net) : '—'}</span>
      </div>
      <div className="flex items-center justify-between border-b border-white/10 py-2">
        <span className="text-xs text-slate-400 uppercase">Pire trade</span>
        <span className="text-sm font-semibold text-red-400">{kpis.worst ? money(kpis.worst.net) : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-2">
        <span className="text-xs text-slate-400 uppercase">Série en cours</span>
        <span className={`text-sm font-semibold ${streak?.isWin ? 'text-blue-400' : 'text-red-400'}`}>
          {streak ? `${streak.count} ${streak.isWin ? 'gain(s)' : 'perte(s)'}` : '—'}
        </span>
      </div>
    </div>
  )
}
