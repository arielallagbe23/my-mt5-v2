import { formatSignedPct, money } from './journalStats'

export function BestWorstStreakCard({ kpis, streak, todayNet, accountSize }) {
  // Même règle que partout ailleurs dans le Journal : le % se rapporte au
  // capital de base fixe (account_size), jamais à l'équité live.
  const todayPct = typeof todayNet === 'number' && accountSize ? (todayNet / accountSize) * 100 : null
  const netTotal = kpis.netTotal

  return (
    <div className="h-full overflow-hidden rounded-sm border border-white/10 bg-white/5">
      <div className={`p-6 ${netTotal >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
        <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L net total</p>
        <p className={`mt-1 text-4xl font-bold ${netTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {money(netTotal)}
        </p>
      </div>
      <div className="px-3">
        <div className="flex items-center justify-between border-t border-white/10 py-2">
          <span className="text-xs text-slate-400 uppercase">Meilleur trade</span>
          <span className="text-sm font-semibold text-emerald-400">{kpis.best ? money(kpis.best.net) : '—'}</span>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 py-2">
          <span className="text-xs text-slate-400 uppercase">Pire trade</span>
          <span className="text-sm font-semibold text-red-400">{kpis.worst ? money(kpis.worst.net) : '—'}</span>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 py-2">
          <span className="text-xs text-slate-400 uppercase">Série en cours</span>
          <span className={`text-sm font-semibold ${streak?.isWin ? 'text-emerald-400' : 'text-red-400'}`}>
            {streak ? `${streak.count} ${streak.isWin ? 'gain(s)' : 'perte(s)'}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 py-2">
          <span className="text-xs text-slate-400 uppercase">Bénéfice de la journée</span>
          <span className={`text-sm font-semibold ${todayPct === null || todayPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatSignedPct(todayPct)}
          </span>
        </div>
      </div>
    </div>
  )
}
