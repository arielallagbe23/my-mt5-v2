const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatMonthLabel(key) {
  const month = Number(key.slice(5, 7))
  return MONTH_LABELS[month - 1] ?? key.slice(5)
}

export function MonthlyBars({ monthly }) {
  if (monthly.length === 0) return null
  const maxAbs = Math.max(...monthly.map(([, v]) => Math.abs(v)), 1)

  return (
    <div className="flex h-24 items-end gap-2">
      {monthly.map(([key, value]) => (
        <div key={key} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`w-full rounded-t ${value >= 0 ? 'bg-blue-500' : 'bg-red-500'}`}
            style={{ height: `${Math.max(4, (Math.abs(value) / maxAbs) * 80)}px` }}
          />
          <span className="text-[10px] text-slate-500">{formatMonthLabel(key)}</span>
        </div>
      ))}
    </div>
  )
}
