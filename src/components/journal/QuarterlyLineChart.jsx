import { useId } from 'react'
import { formatAxisValue, formatQuarterLabel } from './journalStats'

export function QuarterlyLineChart({ quarterly, unit, accountSize }) {
  // id unique par instance — voir la même précaution dans PerformanceCurve.jsx
  // (un id de gradient dupliqué en SVG fait bleeder la couleur d'un graphique
  // dans l'autre quand plusieurs instances sont rendues sur la même page).
  const gradientId = useId()

  return (
    <div className="flex h-full flex-col rounded-sm border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">P&amp;L par trimestre</p>
      {quarterly.length < 2 ? (
        <p className="text-sm text-slate-400">Pas assez de trimestres pour tracer une courbe.</p>
      ) : (
        <Chart quarterly={quarterly} unit={unit} accountSize={accountSize} gradientId={gradientId} />
      )}
    </div>
  )
}

function Chart({ quarterly, unit, accountSize, gradientId }) {
  const values = quarterly.map(([, v]) => (unit === 'pct' && accountSize ? (v / accountSize) * 100 : v))
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const last = values[values.length - 1]
  const color = last >= 0 ? '#60a5fa' : '#f87171'

  function yFor(v) {
    return 100 - ((v - min) / range) * 100
  }

  const points = values.map((v, i) => ({ x: (i / (values.length - 1)) * 100, y: yFor(v) }))
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ')
  const zeroY = yFor(0)
  const areaPoints = `0,${zeroY} ${linePoints} 100,${zeroY}`
  const lastPoint = points[points.length - 1]

  return (
    <div className="flex h-48 gap-2">
      <div className="relative w-11 shrink-0 font-mono text-xs text-slate-500">
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
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
            <polygon points={areaPoints} fill={`url(#${gradientId})`} />
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
        <div className="mt-1 flex justify-between font-mono text-[9px] whitespace-nowrap text-slate-500">
          {quarterly.map(([key]) => (
            <span key={key}>{formatQuarterLabel(key)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
