import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE } from '../lib/layout'

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

const STATUS_LABELS = {
  draft: 'Brouillon',
  pending: 'En attente',
  dry_run_done: 'Simulée (dry-run)',
  done: 'Terminée',
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
      .then(setTasks)
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
              <span className="col-span-2">
                Statut : <span className="font-semibold text-white">{STATUS_LABELS[task.status] ?? task.status}</span>
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              {task.status === 'draft' && (
                <button
                  type="button"
                  onClick={() => onEditTask?.(task.id)}
                  className="min-h-9 flex-1 rounded-xl bg-indigo-500/15 text-sm font-semibold text-indigo-300"
                >
                  Continuer
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
