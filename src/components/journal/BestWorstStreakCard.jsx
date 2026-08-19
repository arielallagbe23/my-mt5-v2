import { formatSignedPct, money } from './journalStats'

export function BestWorstStreakCard({ kpis, streak, todayNet, accountSize }) {
  // Même règle que partout ailleurs dans le Journal : le % se rapporte au
  // capital de base fixe (account_size), jamais à l'équité live.
  const todayPct = typeof todayNet === 'number' && accountSize ? (todayNet / accountSize) * 100 : null

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
      <div className="flex items-center justify-between border-b border-white/10 py-2">
        <span className="text-xs text-slate-400 uppercase">Série en cours</span>
        <span className={`text-sm font-semibold ${streak?.isWin ? 'text-blue-400' : 'text-red-400'}`}>
          {streak ? `${streak.count} ${streak.isWin ? 'gain(s)' : 'perte(s)'}` : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between py-2">
        <span className="text-xs text-slate-400 uppercase">Bénéfice de la journée</span>
        <span className={`text-sm font-semibold ${todayPct === null || todayPct >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
          {formatSignedPct(todayPct)}
        </span>
      </div>
    </div>
  )
}
