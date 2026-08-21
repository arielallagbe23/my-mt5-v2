import { useState } from 'react'
import { money } from './journalStats'

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export function TradingCalendarCard({ dailyNet }) {
  const [monthOffset, setMonthOffset] = useState(0)

  const now = new Date()
  const shown = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const year = shown.getFullYear()
  const month = shown.getMonth() // 0-indexé
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // getDay() : 0=dimanche...6=samedi -> converti pour que la semaine commence lundi (0=lundi...6=dimanche)
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7

  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const monthLabel = shown.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthOffset((o) => o - 1)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-slate-300"
          aria-label="Mois précédent"
        >
          ‹
        </button>
        <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">{monthLabel}</p>
        <button
          type="button"
          onClick={() => setMonthOffset((o) => o + 1)}
          disabled={monthOffset === 0}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-slate-300 disabled:opacity-30"
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((label) => (
          <p key={label} className="text-center text-[10px] font-semibold text-slate-500 uppercase">
            {label}
          </p>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />

          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const net = dailyNet.get(key)
          const hasTrade = typeof net === 'number' && net !== 0

          return (
            <div
              key={key}
              title={hasTrade ? money(net) : undefined}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${
                hasTrade
                  ? net > 0
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'bg-red-500/20 text-red-300'
                  : 'text-slate-500'
              }`}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}
