import { PLAN_OPTIONS, EXIT_OPTIONS, EMOTION_OPTIONS } from './mistakeOptions'

// Nombre d'entrées en dessous duquel on n'affiche pas les cartes stats du
// tout (trop peu de données pour qu'un pourcentage ou une corrélation ait
// un sens) — voir MIN_ENTRIES_FOR_STATS dans MistakesStats.jsx.
export const MIN_ENTRIES_FOR_STATS = 5

// Occurrences minimum pour qu'une combinaison (ex : "plan non respecté" +
// "confiant") soit affichée comme insight de corrélation — évite de sortir
// une "tendance" sur 1 ou 2 cas isolés.
const MIN_CORRELATION_OCCURRENCES = 3

function countBy(entries, field) {
  const counts = {}
  for (const m of entries) {
    const value = m[field]
    if (!value) continue
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

// Répartition en %, dans l'ordre fixe des options (plan/raison de sortie) —
// garde les options à 0% visibles pour que la barre reste comparable d'une
// visite à l'autre.
export function computeBreakdown(mistakes, field, options) {
  const total = mistakes.filter((m) => m[field]).length
  const counts = countBy(mistakes, field)
  return options.map((opt) => ({
    ...opt,
    count: counts[opt.value] ?? 0,
    pct: total > 0 ? Math.round(((counts[opt.value] ?? 0) / total) * 100) : 0,
  }))
}

// Même chose mais triée de la plus fréquente à la moins fréquente, et sans
// les options jamais rencontrées (utilisé pour les émotions).
export function computeSortedBreakdown(mistakes, field, options) {
  return computeBreakdown(mistakes, field, options)
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
}

// Insight (a) : parmi les trades où le plan n'a PAS été respecté, quelles
// émotions reviennent le plus souvent — seulement les combinaisons vues au
// moins MIN_CORRELATION_OCCURRENCES fois.
export function computePlanBrokenByEmotion(mistakes) {
  const notRespected = mistakes.filter((m) => m.planRespected === 'no')
  if (notRespected.length === 0) return []
  const counts = countBy(notRespected, 'emotion')
  return EMOTION_OPTIONS.map((opt) => ({
    ...opt,
    count: counts[opt.value] ?? 0,
    total: notRespected.length,
    pct: Math.round(((counts[opt.value] ?? 0) / notRespected.length) * 100),
  }))
    .filter((row) => row.count >= MIN_CORRELATION_OCCURRENCES)
    .sort((a, b) => b.count - a.count)
}

// Insight (b) : parmi les sorties manuelles par peur, l'état du plan
// (respecté quand même, ou pas) — pour voir si la peur fait sortir même
// quand tout allait bien.
export function computeFearExitByPlan(mistakes) {
  const fearExits = mistakes.filter((m) => m.exitReason === 'manual_fear')
  if (fearExits.length === 0) return []
  const counts = countBy(fearExits, 'planRespected')
  return PLAN_OPTIONS.map((opt) => ({
    ...opt,
    count: counts[opt.value] ?? 0,
    total: fearExits.length,
    pct: Math.round(((counts[opt.value] ?? 0) / fearExits.length) * 100),
  }))
    .filter((row) => row.count >= MIN_CORRELATION_OCCURRENCES)
    .sort((a, b) => b.count - a.count)
}

function startOfWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const mondayOffset = (d.getDay() + 6) % 7 // 0 = lundi
  d.setDate(d.getDate() - mondayOffset)
  return d
}

// Nombre de trades "plan non respecté" par semaine (lundi-dimanche), sur
// les `weeks` dernières semaines glissantes (incluant la semaine en cours).
export function computeWeeklyNonCompliance(mistakes, weeks = 8) {
  const currentWeekStart = startOfWeek(new Date())
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(currentWeekStart)
    start.setDate(start.getDate() - i * 7)
    buckets.push({ start, count: 0 })
  }

  for (const m of mistakes) {
    if (m.planRespected !== 'no' || typeof m.createdAt !== 'number') continue
    const weekStart = startOfWeek(new Date(m.createdAt))
    const bucket = buckets.find((b) => b.start.getTime() === weekStart.getTime())
    if (bucket) bucket.count += 1
  }

  return buckets.map((b) => ({
    label: b.start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    count: b.count,
  }))
}
