import { formatDate, formatVolume, money } from './journalStats'

export function TransactionsTable({ trades, pageTrades, page, totalPages, onPrevPage, onNextPage }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Transactions</p>
        <span className="text-xs text-slate-500">{trades.length} au total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="pb-2 pr-2 font-normal">Date</th>
              <th className="pb-2 pr-2 font-normal">Type</th>
              <th className="pb-2 pr-2 font-normal">Vol.</th>
              <th className="pb-2 pr-2 font-normal">Prix</th>
              <th className="pb-2 font-normal">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {pageTrades.map((t) => (
              <tr key={t.positionId} className="border-t border-white/5">
                <td className="py-2 pr-2 whitespace-nowrap text-slate-400">{formatDate(t.closeTime)}</td>
                <td className={`py-2 pr-2 font-semibold ${t.type === 'Sell' ? 'text-red-400' : 'text-blue-400'}`}>
                  {t.type === 'Sell' ? 'SELL' : 'BUY'}
                </td>
                <td className="py-2 pr-2 text-slate-300">{formatVolume(t.volume)}</td>
                <td className="py-2 pr-2 text-slate-300">{t.priceClose}</td>
                <td className={`py-2 font-semibold ${t.net >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                  {money(t.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onPrevPage}
            disabled={page === 1}
            className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            ← Préc.
          </button>
          <span className="text-xs text-slate-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={onNextPage}
            disabled={page === totalPages}
            className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            Suiv. →
          </button>
        </div>
      )}
    </div>
  )
}
