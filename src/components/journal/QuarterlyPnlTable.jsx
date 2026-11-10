import { useState } from 'react'
import { formatAxisValue, formatQuarterLabel } from './journalStats'

const PAGE_SIZE = 8

export function QuarterlyPnlTable({ quarterly, unit, accountSize }) {
  const [page, setPage] = useState(1)
  if (quarterly.length === 0) return null

  const reversed = [...quarterly].reverse()
  const totalPages = Math.max(1, Math.ceil(reversed.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = reversed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="flex h-full flex-col rounded-sm border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L par trimestre</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="pb-2 font-normal">Trimestre</th>
              <th className="pb-2 text-right font-normal">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map(([key, value]) => (
              <tr key={key} className="border-t border-white/5">
                <td className="py-2 whitespace-nowrap">{formatQuarterLabel(key)}</td>
                <td
                  className={`py-2 text-right whitespace-nowrap font-semibold ${value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {formatAxisValue(unit === 'pct' && accountSize ? (value / accountSize) * 100 : value, unit)}
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            ← Préc.
          </button>
          <span className="text-xs text-slate-500">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="min-h-8 rounded-full border border-white/10 px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            Suiv. →
          </button>
        </div>
      )}
    </div>
  )
}
