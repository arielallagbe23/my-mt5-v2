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
          <span className="text-[10px] text-slate-500">{key.slice(5)}</span>
        </div>
      ))}
    </div>
  )
}
