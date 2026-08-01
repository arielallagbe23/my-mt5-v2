export const FIB_LEVELS = [
  { level: 1, tone: 'gray' },
  { level: 0.975, tone: 'gray' },
  { level: 0.8, tone: 'red' },
  { level: 0.618, tone: 'gray' },
  { level: 0.588, tone: 'blue' },
  { level: 0.5, tone: 'gray' },
  { level: 0.475, tone: 'blue' },
  { level: 0.236, tone: 'amber' },
  { level: 0, tone: 'red' },
  { level: -0.05, tone: 'blue' },
]

export const TONE_CLASSES = {
  gray: { text: 'text-slate-400', line: 'bg-slate-500' },
  red: { text: 'text-red-400', line: 'bg-red-500' },
  blue: { text: 'text-blue-400', line: 'bg-blue-500' },
  amber: { text: 'text-amber-400', line: 'bg-amber-500' },
}

export const EDGE_PADDING = 10 // % d'espace laissé en haut et en bas du rectangle

export function computeFiboLevels(hi, lo) {
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null
  return FIB_LEVELS.map(({ level, tone }) => ({ level, tone, price: lo + (hi - lo) * level }))
}

export function formatPrice(value) {
  return typeof value === 'number' ? value.toFixed(3) : '—'
}
