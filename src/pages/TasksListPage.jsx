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
}

// Une tâche dans cet état a forcément été évaluée : sa condition a été
// remplie (sinon elle aurait été supprimée avec un rapport dans
// execution_reports — voir _report_and_delete côté VPS), donc task.result
// contient toujours entry/sl/tp/lot (et éventuellement ticket ou error en
// mode réel).
const EXECUTED_STATUSES = new Set(['dry_run_done', 'done'])

// Les tâches à venir (brouillon/en attente) restent en haut ; l'historique
// (déjà évalué) descend en bas — tri stable, donc l'ordre par executionTime
// déjà renvoyé par l'API est conservé à l'intérieur de chaque groupe.
function sortTasks(tasks) {
  return [...tasks].sort((a, b) => Number(EXECUTED_STATUSES.has(a.status)) - Number(EXECUTED_STATUSES.has(b.status)))
}

export function TasksListPage({ onEditTask }) {
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    loadTasks()
  }, [])

  function loadTasks() {
    setLoading(true)
    api
      .listTasks()
      .then((data) => setTasks(sortTasks(data)))
      .catch(() => setError('Impossible de charger les tâches'))
      .finally(() => setLoading(false))
  }

  async function handleDelete(id) {
    setDeletingId(id)
    try {
      await api.deleteTask(id)
      setTasks((current) => current.filter((t) => t.id !== id))
    } catch {
      setError('Impossible de supprimer la tâche')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Liste des tâches</h1>

      {loading && <p className="text-sm text-slate-400">Chargement...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && tasks?.length === 0 && (
        <p className="text-sm text-slate-400">Aucune tâche enregistrée pour le moment.</p>
      )}

      <ul className="flex flex-col gap-2">
        {tasks?.map((task) => (
          <li key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  task.scenario === 'sell'
                    ? 'bg-red-500/15 text-red-300'
                    : task.scenario === 'buy'
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'bg-white/10 text-slate-300'
                }`}
              >
                {task.scenario === 'sell' ? 'Vendre' : task.scenario === 'buy' ? 'Acheter' : 'Brouillon'}
              </span>
              <span className="text-xs text-slate-400">{formatDateTime(task.executionTime)}</span>
            </div>

            {EXECUTED_STATUSES.has(task.status) && task.result ? (
              <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-2 text-xs">
                <p className={`font-semibold ${task.result.error ? 'text-red-400' : 'text-blue-400'}`}>
                  {task.result.error
                    ? "Échec de l'ordre"
                    : task.status === 'dry_run_done'
                      ? 'Condition respectée (simulation)'
                      : 'Condition respectée — ordre pris'}
                </p>
                <p className="mt-0.5 text-slate-500">à {formatExecutedAt(task.updatedAt)}</p>
                {task.result.error ? (
                  <p className="mt-1 text-slate-400">{task.result.error}</p>
                ) : (
                  <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400">
                    <span>
                      Entrée : <span className="font-semibold text-white">{task.result.entry}</span>
                    </span>
                    <span>
                      Lot : <span className="font-semibold text-white">{task.result.lot}</span>
                    </span>
                    <span>
                      SL : <span className="font-semibold text-white">{task.result.sl}</span>
                    </span>
                    <span>
                      TP : <span className="font-semibold text-white">{task.result.tp}</span>
                    </span>
                    {task.result.ticket && (
                      <span className="col-span-2">
                        Ticket MT5 : <span className="font-semibold text-white">{task.result.ticket}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
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
            )}

            <p className="mt-2 text-xs text-slate-500">
              Statut : <span className="font-semibold text-white">{STATUS_LABELS[task.status] ?? task.status}</span>
            </p>

            <div className="mt-3 flex gap-2">
              {(task.status === 'draft' || task.status === 'pending') && (
                <button
                  type="button"
                  onClick={() => onEditTask?.(task.id)}
                  className="min-h-9 flex-1 rounded-xl bg-indigo-500/15 text-sm font-semibold text-indigo-300"
                >
                  {task.status === 'draft' ? 'Continuer' : 'Modifier'}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(task.id)}
                disabled={deletingId === task.id}
                className="min-h-9 flex-1 rounded-xl bg-red-500/15 text-sm font-semibold text-red-300 disabled:opacity-60"
              >
                {deletingId === task.id ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
