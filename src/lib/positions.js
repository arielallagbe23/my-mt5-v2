export function formatExecutionTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export function formatHistoryTime(ts) {
  return typeof ts === 'number'
    ? new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—'
}

// Le trailing stop côté VPS ne déplace jamais le SL ailleurs qu'à ces 3
// paliers précis (entrée + 0/25/50% de la distance entrée→TP — voir
// SL_STAGES dans mt5-vps/positions.py). On retrouve le palier actuel en
// comparant le SL courant à ces mêmes niveaux, sans rien demander au VPS.
export const SL_STAGES = [
  { pct: 50, label: 'SL à 50%' },
  { pct: 25, label: 'SL à 25%' },
  { pct: 0, label: 'SL à BE' },
]
export const SL_STAGE_TOLERANCE_PCT = 2 // marge pour l'arrondi/spread

export function slStageLabel(p) {
  if (!p.sl || !p.tp || typeof p.priceOpen !== 'number') return null
  const totalDistance = p.tp - p.priceOpen
  if (!totalDistance) return null
  const progress = ((p.sl - p.priceOpen) / totalDistance) * 100
  return SL_STAGES.find((s) => Math.abs(progress - s.pct) <= SL_STAGE_TOLERANCE_PCT)?.label ?? null
}
