export function FiboChart({ linePositions, labelPositions, highlightZone }) {
  if (!labelPositions.length) {
    return <div className="h-80 rounded-2xl border border-white/10 bg-white/5" />
  }

  return (
    <div className="flex h-100 gap-1">
      <div className="relative w-1/6 shrink-0 rounded-xl border border-white/10 bg-white/5 px-4">
        {labelPositions.map(({ key, textClass, pos, percentLabel }) => (
          <span
            key={key}
            className={`absolute inset-x-0 text-center text-[8px] font-semibold ${textClass}`}
            style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
          >
            {percentLabel}
          </span>
        ))}
      </div>

      <div className="relative w-4/6 flex-1 rounded-xl border border-white/10 bg-white/5 py-2">
        {highlightZone && (
          <div
            className="absolute left-0 right-0 bg-amber-500/20"
            style={{ top: `${highlightZone.top}%`, height: `${highlightZone.height}%` }}
          />
        )}

        {linePositions.map(({ key, lineClass, pos }) => (
          <span
            key={key}
            className={`absolute left-0 right-0 h-px ${lineClass}`}
            style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
          />
        ))}
      </div>

      <div className="relative w-1/6 shrink-0 rounded-xl border border-white/10 bg-white/5">
        {labelPositions.map(({ key, textClass, pos, priceLabel }) => (
          <span
            key={key}
            className={`absolute inset-x-0 text-center text-[8px] font-semibold ${textClass}`}
            style={{ top: `${pos}%`, transform: 'translateY(-50%)' }}
          >
            {priceLabel}
          </span>
        ))}
      </div>
    </div>
  )
}
