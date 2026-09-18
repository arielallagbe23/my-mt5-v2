import { PLAN_OPTIONS, EXIT_OPTIONS, EMOTION_OPTIONS } from './mistakeOptions'
import {
  MIN_ENTRIES_FOR_STATS,
  computeBreakdown,
  computeSortedBreakdown,
  computePlanBrokenByEmotion,
  computeFearExitByPlan,
  computeWeeklyNonCompliance,
} from './mistakeStats'

function BreakdownCard({ title, rows }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">{title}</p>
      {rows.every((row) => row.count === 0) ? (
        <p className="text-sm text-slate-500">Pas encore de donnée.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.value}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-300">{row.label}</span>
                <span className="font-semibold text-white">
                  {row.pct}% <span className="font-normal text-slate-500">({row.count})</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CorrelationSentence({ children }) {
  return (
    <li className="flex gap-2.5 text-sm text-slate-200">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
      <span>{children}</span>
    </li>
  )
}

function CorrelationsCard({ mistakes }) {
  const planBroken = computePlanBrokenByEmotion(mistakes)
  const fearExits = computeFearExitByPlan(mistakes)
  const hasInsights = planBroken.length > 0 || fearExits.length > 0

  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4">
      <p className="mb-3 text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Corrélations à surveiller</p>
      {!hasInsights ? (
        <p className="text-sm text-slate-500">Pas encore assez de cas répétés pour dégager une tendance fiable.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {planBroken.map((row) => (
            <CorrelationSentence key={`plan-${row.value}`}>
              Sur les <strong className="text-white">{row.total}</strong> fois où tu n'as pas respecté ton plan, tu
              étais <strong className="text-white">« {row.label} »</strong> dans {row.pct}% des cas ({row.count}{' '}
              fois).
            </CorrelationSentence>
          ))}
          {fearExits.map((row) => (
            <CorrelationSentence key={`fear-${row.value}`}>
              Sur les <strong className="text-white">{row.total}</strong> sorties manuelles par peur, ton plan était{' '}
              <strong className="text-white">« {row.label} »</strong> dans {row.pct}% des cas ({row.count} fois).
            </CorrelationSentence>
          ))}
        </ul>
      )}
    </div>
  )
}

function WeeklyTrendCard({ mistakes }) {
  const weekly = computeWeeklyNonCompliance(mistakes)
  const max = Math.max(...weekly.map((w) => w.count), 1)
  const allZero = weekly.every((w) => w.count === 0)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-bold tracking-[0.14em] text-slate-400 uppercase">Évolution dans le temps</p>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        Trades « plan non respecté » par semaine, 8 dernières semaines
      </p>
      {allZero ? (
        <p className="text-sm text-slate-500">Aucun écart de plan sur les 8 dernières semaines — continue comme ça.</p>
      ) : (
        <div className="flex h-36 items-end gap-1.5">
          {weekly.map((w) => (
            <div key={w.label} className="flex h-full flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end justify-center">
                <div
                  className={`w-full max-w-6 rounded-t ${w.count > 0 ? 'bg-red-400' : 'bg-white/10'}`}
                  style={{ height: `${Math.max(4, (w.count / max) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500">{w.count > 0 ? w.count : ''}</span>
              <span className="text-[9px] whitespace-nowrap text-slate-500">{w.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MistakesStats({ mistakes }) {
  if (mistakes.length < MIN_ENTRIES_FOR_STATS) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <p className="text-sm text-slate-400">
          Continue à remplir ton journal pour débloquer les statistiques ({mistakes.length}/{MIN_ENTRIES_FOR_STATS}{' '}
          entrées).
        </p>
      </div>
    )
  }

  const planBreakdown = computeBreakdown(mistakes, 'planRespected', PLAN_OPTIONS)
  const exitBreakdown = computeBreakdown(mistakes, 'exitReason', EXIT_OPTIONS)
  const emotionBreakdown = computeSortedBreakdown(mistakes, 'emotion', EMOTION_OPTIONS)

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
      <BreakdownCard title="Respect du plan" rows={planBreakdown} />
      <BreakdownCard title="Raisons de sortie" rows={exitBreakdown} />
      <BreakdownCard title="États émotionnels" rows={emotionBreakdown} />
      <CorrelationsCard mistakes={mistakes} />
      <div className="lg:col-span-2">
        <WeeklyTrendCard mistakes={mistakes} />
      </div>
    </div>
  )
}
