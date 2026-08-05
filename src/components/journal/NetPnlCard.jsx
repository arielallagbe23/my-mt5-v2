import { money } from './journalStats'

export function NetPnlCard({ netTotal }) {
  return (
    <div
      className={`rounded-3xl border p-6 ${
        netTotal >= 0 ? 'border-blue-500/30 bg-blue-500/10' : 'border-red-500/30 bg-red-500/10'
      }`}
    >
      <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L net total</p>
      <p className={`mt-1 text-4xl font-bold ${netTotal >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
        {money(netTotal)}
      </p>
    </div>
  )
}
