export const PLAN_OPTIONS = [
  { value: 'full', label: 'Oui entièrement', tone: 'bg-emerald-500/15 text-emerald-300', bar: 'bg-emerald-400' },
  { value: 'partial', label: 'Oui partiellement', tone: 'bg-amber-500/15 text-amber-300', bar: 'bg-amber-400' },
  { value: 'no', label: 'Non', tone: 'bg-red-500/15 text-red-300', bar: 'bg-red-400' },
]
export const EXIT_OPTIONS = [
  { value: 'sl', label: 'SL touché', tone: 'bg-indigo-500/15 text-indigo-300', bar: 'bg-indigo-400' },
  { value: 'tp', label: 'TP atteint', tone: 'bg-indigo-500/15 text-indigo-300', bar: 'bg-indigo-400' },
  { value: 'manual_fear', label: 'Sortie manuelle (peur)', tone: 'bg-indigo-500/15 text-indigo-300', bar: 'bg-indigo-400' },
  { value: 'manual_plan', label: 'Sortie manuelle (plan)', tone: 'bg-indigo-500/15 text-indigo-300', bar: 'bg-indigo-400' },
  { value: 'other', label: 'Autre', tone: 'bg-indigo-500/15 text-indigo-300', bar: 'bg-indigo-400' },
]
export const EMOTION_OPTIONS = [
  { value: 'calm', label: 'Calme', tone: 'bg-purple-500/15 text-purple-300', bar: 'bg-purple-400' },
  { value: 'stressed', label: 'Stressé', tone: 'bg-purple-500/15 text-purple-300', bar: 'bg-purple-400' },
  { value: 'impatient', label: 'Impatient', tone: 'bg-purple-500/15 text-purple-300', bar: 'bg-purple-400' },
  { value: 'confident', label: 'Confiant', tone: 'bg-purple-500/15 text-purple-300', bar: 'bg-purple-400' },
  { value: 'hesitant', label: 'Hésitant', tone: 'bg-purple-500/15 text-purple-300', bar: 'bg-purple-400' },
]

export function findOption(options, value) {
  return options.find((o) => o.value === value) ?? null
}
