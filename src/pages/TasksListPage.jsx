import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE } from '../lib/layout'

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

function formatExecutedAt(ms) {
  if (typeof ms !== 'number') return '—'
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

const STATUS_LABELS = {
  draft: 'Brouillon',
  pending: 'En attente',
  dry_run_done: 'Simulée (dry-run)',
  done: 'Terminée',
  not_executed: 'Non exécutée',
}

// dry_run_done/done : la condition a été remplie, task.result contient
// toujours entry/sl/tp/lot (et éventuellement ticket ou error en mode réel).
// not_executed : rapport archivé (condition jamais remplie, tâche déjà
// supprimée côté VPS — voir _report_and_delete) réinjecté dans l'historique
// par GET /api/tasks ; il n'a pas de task.result, seulement task.reason.
const EXECUTED_STATUSES = new Set(['dry_run_done', 'done', 'not_executed'])

const HISTORY_PAGE_SIZE = 10

function scenarioLabel(scenario) {
  return scenario === 'sell' ? 'Vendre' : scenario === 'buy' ? 'Acheter' : 'Brouillon'
}

function scenarioBadgeClass(scenario) {
  return scenario === 'sell'
    ? 'bg-red-500/15 text-red-300'
    : scenario === 'buy'
      ? 'bg-blue-500/15 text-blue-300'
      : 'bg-white/10 text-slate-300'
}

// Résumé sur une ligne pour la colonne "Détail" du tableau d'historique —
// la version carte (encore utilisée pour les tâches en attente) affiche ça
// en grille, mais un tableau a besoin de texte compact par ligne.
function historyDetail(task) {
  if (task.status === 'not_executed') return task.reason ?? '—'
  if (task.result?.error) return task.result.error
  if (task.result) {
    const ticket = task.result.ticket ? ` (ticket ${task.result.ticket})` : ''
    return `Entrée ${task.result.entry} · Lot ${task.result.lot} · SL ${task.result.sl} · TP ${task.result.tp}${ticket}`
  }
  return '—'
}

export function TasksListPage({ onEditTask }) {
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [historyPage, setHistoryPage] = useState(0)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    loadTasks()
  }, [])

  function loadTasks() {
    setLoading(true)
    api
      .listTasks()
      .then(setTasks)
      .catch(() => setError('Impossible de charger les tâches'))
      .finally(() => setLoading(false))
  }

  async function handleDelete(task) {
    setDeletingId(task.id)
    try {
      await (task.source === 'report' ? api.deleteReport(task.id) : api.deleteTask(task.id))
      setTasks((current) => current.filter((t) => t.id !== task.id))
    } catch {
      setError('Impossible de supprimer la tâche')
    } finally {
      setDeletingId(null)
    }
  }

  const pendingTasks = tasks?.filter((t) => !EXECUTED_STATUSES.has(t.status)) ?? []
  const historyTasks = tasks?.filter((t) => EXECUTED_STATUSES.has(t.status)) ?? []

  const pageCount = Math.max(1, Math.ceil(historyTasks.length / HISTORY_PAGE_SIZE))
  const safePage = Math.min(historyPage, pageCount - 1)
  const historyPageItems = historyTasks.slice(safePage * HISTORY_PAGE_SIZE, (safePage + 1) * HISTORY_PAGE_SIZE)

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Liste des tâches</h1>

      {loading && <p className="text-sm text-slate-400">Chargement...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && tasks?.length === 0 && (
        <p className="text-sm text-slate-400">Aucune tâche enregistrée pour le moment.</p>
      )}

      {!loading && !error && pendingTasks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pendingTasks.map((task) => (
            <li key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scenarioBadgeClass(task.scenario)}`}>
                  {scenarioLabel(task.scenario)}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(task.executionTime)}</span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>
                  Timeframe : <span className="font-semibold text-white">{task.timeframe ?? '—'}</span>
                </span>
                <span>
                  Risque : <span className="font-semibold text-white">{task.risk != null ? `${task.risk}%` : '—'}</span>
                </span>
                <span>
                  Condition : <span className="font-semibold text-white">{task.priceCondition ?? '—'}</span>
                </span>
                <span>
                  Support : <span className="font-semibold text-white">{task.supportPrice ?? '—'}</span>
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                Statut : <span className="font-semibold text-white">{STATUS_LABELS[task.status] ?? task.status}</span>
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onEditTask?.(task.id)}
                  className="min-h-9 flex-1 rounded-xl bg-indigo-500/15 text-sm font-semibold text-indigo-300"
                >
                  {task.status === 'draft' ? 'Continuer' : 'Modifier'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(task)}
                  disabled={deletingId === task.id}
                  className="min-h-9 flex-1 rounded-xl bg-red-500/15 text-sm font-semibold text-red-300 disabled:opacity-60"
                >
                  {deletingId === task.id ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && historyTasks.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Historique</p>

          <ul className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            {historyPageItems.map((task, index) => {
              const isOpen = expandedId === task.id
              return (
                <li key={task.id} className={index > 0 ? 'border-t border-white/5' : ''}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : task.id)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
                  >
                    <span className="text-slate-400">{formatDateTime(task.executionTime)}</span>
                    <span className="flex-1 truncate text-right text-slate-500">
                      {STATUS_LABELS[task.status] ?? task.status}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${scenarioBadgeClass(task.scenario)}`}>
                      {scenarioLabel(task.scenario)}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/5 px-3 py-2.5 text-xs">
                      {task.updatedAt && (
                        <p className="mt-0.5 text-slate-600">Évaluée le {formatExecutedAt(task.updatedAt)}</p>
                      )}
                      <p className="mt-1.5 text-slate-400">{historyDetail(task)}</p>
                      <button
                        type="button"
                        onClick={() => handleDelete(task)}
                        disabled={deletingId === task.id}
                        className="mt-2 font-semibold text-red-300 disabled:opacity-60"
                      >
                        {deletingId === task.id ? 'Suppression...' : 'Supprimer'}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <button
                type="button"
                onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="min-h-8 rounded-full bg-white/10 px-3 font-semibold disabled:opacity-40"
              >
                Précédent
              </button>
              <span>
                Page {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setHistoryPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="min-h-8 rounded-full bg-white/10 px-3 font-semibold disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
