import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'

export function AssigneesPage() {
  const [assignees, setAssignees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pseudo, setPseudo] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editPseudo, setEditPseudo] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  function load() {
    api
      .listAssignees()
      .then(setAssignees)
      .catch(() => setError('Impossible de charger les assignés'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd() {
    const trimmed = pseudo.trim()
    if (!trimmed) return
    setSaving(true)
    setError('')
    try {
      const created = await api.createAssignee(trimmed)
      setAssignees((current) => [...current, created])
      setPseudo('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    setBusyId(id)
    try {
      await api.deleteAssignee(id)
      setAssignees((current) => current.filter((a) => a.id !== id))
    } catch {
      load()
    } finally {
      setBusyId(null)
    }
  }

  function startEdit(a) {
    setEditError('')
    setEditPseudo(a.pseudo)
    setEditingId(a.id)
  }

  function cancelEdit() {
    setEditError('')
    setEditingId(null)
  }

  async function saveEdit(id) {
    const trimmed = editPseudo.trim()
    if (!trimmed) return
    setEditError('')
    setEditSaving(true)
    try {
      await api.updateAssignee(id, trimmed)
      setAssignees((current) => current.map((a) => (a.id === id ? { ...a, pseudo: trimmed } : a)))
      setEditingId(null)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div className={`${PAGE} lg:mx-0`}>
      <h1 className={PAGE_TITLE}>Assignés</h1>
      <p className="text-sm text-slate-400">
        Liste des pseudos que tu pourras assigner plus tard (comptes, tâches...).
      </p>

      <div className="flex flex-col gap-2 rounded-sm border border-white/10 bg-white/5 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Pseudo"
            className={`${FIELD_INPUT} flex-1`}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !pseudo.trim()}
            className="min-h-10 shrink-0 rounded-sm bg-amber-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '...' : 'Ajouter'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Chargement...</p>}

      {!loading && (
        <div className="flex flex-col gap-2">
          {assignees.length === 0 && <p className="text-sm text-slate-400">Aucun assigné pour l'instant.</p>}
          {assignees.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-sm border border-white/10 bg-white/5 p-3">
              {editingId === a.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={editPseudo}
                    onChange={(e) => setEditPseudo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(a.id)}
                    className={`${FIELD_INPUT} flex-1`}
                  />
                  {editError && <p className="text-xs text-red-400">{editError}</p>}
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={editSaving}
                    className="min-h-8 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-300 disabled:opacity-60"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(a.id)}
                    disabled={editSaving || !editPseudo.trim()}
                    className="min-h-8 rounded-full bg-amber-500/15 px-3 text-xs font-semibold text-amber-300 disabled:opacity-60"
                  >
                    {editSaving ? '...' : 'Enregistrer'}
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-semibold text-white">{a.pseudo}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      className="min-h-8 rounded-full bg-white/5 px-3 text-xs font-semibold text-slate-300"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      disabled={busyId === a.id}
                      className="min-h-8 rounded-full border border-red-500/30 px-3 text-xs font-semibold text-red-400 disabled:opacity-60"
                    >
                      {busyId === a.id ? '...' : 'Supprimer'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
