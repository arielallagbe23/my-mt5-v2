import { formatAxisValue } from './journalStats'

export function PerformanceCurve({ curve, unit }) {
  if (curve.length < 2) {
    return <p className="text-sm text-slate-400">Pas assez de trades pour tracer une courbe.</p>
  }

  const min = Math.min(0, ...curve)
  const max = Math.max(0, ...curve)
  const range = max - min || 1
  const last = curve[curve.length - 1]
  const color = last >= 0 ? '#60a5fa' : '#f87171'

  function yFor(v) {
    return 100 - ((v - min) / range) * 100
  }

  const points = curve.map((v, i) => ({ x: (i / (curve.length - 1)) * 100, y: yFor(v) }))
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ')
  const zeroY = yFor(0)
  const areaPoints = `0,${zeroY} ${linePoints} 100,${zeroY}`
  const lastPoint = points[points.length - 1]

  return (
    <div className="flex gap-2">
      <div className="relative h-32 w-11 shrink-0 font-mono text-xs text-slate-500">
        {max > 0 && (
          <span className="absolute left-0 -translate-y-1/2" style={{ top: `${yFor(max)}%` }}>
            {formatAxisValue(max, unit)}
          </span>
        )}
        <span className="absolute left-0 -translate-y-1/2" style={{ top: `${zeroY}%` }}>
          {unit === 'pct' ? '0.00%' : '0 $'}
        </span>
        {min < 0 && (
          <span className="absolute left-0 -translate-y-1/2" style={{ top: `${yFor(min)}%` }}>
            {formatAxisValue(min, unit)}
          </span>
        )}
      </div>
      <div className="relative h-32 flex-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="performanceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1="0"
            y1={zeroY}
            x2="100"
            y2={zeroY}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3,3"
            className="text-slate-600"
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={areaPoints} fill="url(#performanceGradient)" />
          <polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-slate-950"
          style={{ left: `${lastPoint.x}%`, top: `${lastPoint.y}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
