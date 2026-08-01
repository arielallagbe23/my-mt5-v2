import { formatPrice } from '../../lib/fibo'

export function CandleTable({ candle }) {
  if (!candle) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <table className="w-full text-xs">
        <tbody>
          {[
            ['Open', formatPrice(candle.open)],
            ['High', formatPrice(candle.high)],
            ['Low', formatPrice(candle.low)],
            ['Close', formatPrice(candle.close)],
            ['Volume', candle.volume ?? '—'],
          ].map(([label, value]) => (
            <tr key={label} className="border-t border-white/5 first:border-t-0">
              <td className="py-1.5 text-slate-400">{label}</td>
              <td className="py-1.5 text-right font-semibold text-white">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
