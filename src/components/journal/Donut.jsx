const DONUT_CX = 50
const DONUT_CY = 50
const DONUT_OUTER_RADIUS = 42
const DONUT_INNER_RADIUS = 26
const DONUT_CORNER_RADIUS = 2.5
const DONUT_PAD_RAD = 0.1 // espace angulaire entre segments (~5.7°)
// Plancher de balayage (rad) sous lequel un segment minuscule casserait le
// tracé (coins arrondis qui se chevauchent) — voir le calcul dans le chat :
// il faut au moins ~2×DONUT_CORNER_RADIUS d'arc au rayon intérieur.
const DONUT_MIN_SWEEP_RAD = 0.22

function segmentPath({ startAngle, sweep }) {
  const large = sweep > Math.PI ? 1 : 0
  const sa = startAngle
  const ea = startAngle + sweep
  const tsa = sa + Math.PI / 2 // tangente au départ
  const tea = ea + Math.PI / 2 // tangente à la fin

  const point = (radius, angle) => [DONUT_CX + radius * Math.cos(angle), DONUT_CY + radius * Math.sin(angle)]

  const [x1o, y1o] = point(DONUT_OUTER_RADIUS, sa)
  const [x2o, y2o] = point(DONUT_OUTER_RADIUS, ea)
  const [x1i, y1i] = point(DONUT_INNER_RADIUS, sa)
  const [x2i, y2i] = point(DONUT_INNER_RADIUS, ea)
  const cr = DONUT_CORNER_RADIUS

  return [
    `M ${DONUT_CX + (DONUT_OUTER_RADIUS - cr) * Math.cos(sa)} ${DONUT_CY + (DONUT_OUTER_RADIUS - cr) * Math.sin(sa)}`,
    `Q ${x1o} ${y1o} ${DONUT_CX + DONUT_OUTER_RADIUS * Math.cos(sa) + cr * Math.cos(tsa)} ${DONUT_CY + DONUT_OUTER_RADIUS * Math.sin(sa) + cr * Math.sin(tsa)}`,
    `A ${DONUT_OUTER_RADIUS} ${DONUT_OUTER_RADIUS} 0 ${large} 1 ${DONUT_CX + DONUT_OUTER_RADIUS * Math.cos(ea) - cr * Math.cos(tea)} ${DONUT_CY + DONUT_OUTER_RADIUS * Math.sin(ea) - cr * Math.sin(tea)}`,
    `Q ${x2o} ${y2o} ${DONUT_CX + (DONUT_OUTER_RADIUS - cr) * Math.cos(ea)} ${DONUT_CY + (DONUT_OUTER_RADIUS - cr) * Math.sin(ea)}`,
    `L ${DONUT_CX + (DONUT_INNER_RADIUS + cr) * Math.cos(ea)} ${DONUT_CY + (DONUT_INNER_RADIUS + cr) * Math.sin(ea)}`,
    `Q ${x2i} ${y2i} ${DONUT_CX + DONUT_INNER_RADIUS * Math.cos(ea) - cr * Math.cos(tea)} ${DONUT_CY + DONUT_INNER_RADIUS * Math.sin(ea) - cr * Math.sin(tea)}`,
    `A ${DONUT_INNER_RADIUS} ${DONUT_INNER_RADIUS} 0 ${large} 0 ${DONUT_CX + DONUT_INNER_RADIUS * Math.cos(sa) + cr * Math.cos(tsa)} ${DONUT_CY + DONUT_INNER_RADIUS * Math.sin(sa) + cr * Math.sin(tsa)}`,
    `Q ${x1i} ${y1i} ${DONUT_CX + (DONUT_INNER_RADIUS + cr) * Math.cos(sa)} ${DONUT_CY + (DONUT_INNER_RADIUS + cr) * Math.sin(sa)}`,
    'Z',
  ].join(' ')
}

export function Donut({ breakdown }) {
  const { tp, slLoss, slProtected, other, total } = breakdown
  if (total === 0) return null

  const rawSegments = [
    { value: tp, color: '#3b82f6', label: 'Take Profit' },
    { value: slLoss, color: '#ef4444', label: 'Stop Loss' },
    { value: slProtected, color: '#22c55e', label: 'SL protégé (BE+)' },
    { value: other, color: '#f59e0b', label: 'Autre' },
  ].filter((s) => s.value > 0)

  // Démarre en haut (12h) et balaie dans le sens horaire — même convention
  // que le reste de l'app. Un même pad angulaire fixe sépare chaque paire de
  // segments voisins, y compris entre le dernier et le premier (la boucle
  // revient exactement à son point de départ après un tour complet).
  let angle = -Math.PI / 2
  const arcs = rawSegments.map((s) => {
    const fraction = s.value / total
    const fullSweep = fraction * Math.PI * 2
    const sweep = Math.max(DONUT_MIN_SWEEP_RAD, fullSweep - DONUT_PAD_RAD)
    const startAngle = angle + DONUT_PAD_RAD / 2
    angle += fullSweep
    return { ...s, d: segmentPath({ startAngle, sweep }) }
  })

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-48 w-48">
        {arcs.map((a) => (
          <path key={a.label} d={a.d} fill={a.color} />
        ))}
      </svg>
      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-400">
        {rawSegments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span>
              {s.label} <span className="font-semibold text-white">{Math.round((s.value / total) * 100)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
