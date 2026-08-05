import { money, pct } from './journalStats'

export function KpiGrid({ kpis }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs text-slate-400 uppercase">Win rate</p>
        <p className="text-xl font-bold text-white">{pct(kpis.winRate)}</p>
        <p className="text-xs text-slate-500">
          {kpis.winCount} / {kpis.total}
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs text-slate-400 uppercase">Profit factor</p>
        <p className="text-xl font-bold text-white">
          {kpis.profitFactor === null ? '—' : kpis.profitFactor.toFixed(2)}
        </p>
        <p className="text-xs text-slate-500">
          {kpis.profitFactor === null ? '—' : kpis.profitFactor >= 1 ? 'favorable' : 'défavorable'}
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs text-slate-400 uppercase">Gain moyen</p>
        <p className="text-xl font-bold text-blue-400">{money(kpis.avgWin)}</p>
        <p className="text-xs text-slate-500">par trade gagnant</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs text-slate-400 uppercase">Perte moyenne</p>
        <p className="text-xl font-bold text-red-400">{money(kpis.avgLoss)}</p>
        <p className="text-xs text-slate-500">par trade perdant</p>
      </div>
    </div>
  )
}
