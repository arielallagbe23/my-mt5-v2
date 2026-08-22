const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatMonthLabel(key) {
  const [year, month] = key.split('-')
  const label = MONTH_LABELS[Number(month) - 1] ?? month
  return `${label} ${year.slice(2)}`
}

const BAR_WIDTH = 40 // px — largeur fixe par mois, jamais compressée

export function MonthlyBars({ monthly }) {
  if (monthly.length === 0) return null
  const maxAbs = Math.max(...monthly.map(([, v]) => Math.abs(v)), 1)

  return (
    <div className="overflow-x-auto">
      <div className="flex h-40 items-end gap-2" style={{ width: monthly.length * (BAR_WIDTH + 8) }}>
        {monthly.map(([key, value]) => (
          <div key={key} className="flex shrink-0 flex-col items-center gap-1" style={{ width: BAR_WIDTH }}>
            <div
              className={`w-full rounded-t ${value >= 0 ? 'bg-blue-500' : 'bg-red-500'}`}
              style={{ height: `${Math.max(4, (Math.abs(value) / maxAbs) * 130)}px` }}
            />
            <span className="text-[10px] whitespace-nowrap text-slate-500">{formatMonthLabel(key)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
