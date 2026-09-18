import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'
import { PLAN_OPTIONS, EXIT_OPTIONS, EMOTION_OPTIONS, findOption } from '../components/mistakes/mistakeOptions'
import { MistakesStats } from '../components/mistakes/MistakesStats'

function formatDate(ts) {
  if (typeof ts !== 'number') return '—'
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Capture collée depuis le presse-papiers (Cmd/Ctrl+V) — ex : un screenshot
// copié directement depuis MT5/TradingView, sans passer par le sélecteur
// de fichier.
function imagesFromClipboard(e) {
  const files = []
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}

function Tag({ tone, children }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>
}

function ChoiceGroup({ label, options, value, onChange, disabled }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
            className={`min-h-8 rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
              value === opt.value ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const IMAGE_SIZE_MIN = 120
const IMAGE_SIZE_MAX = 480
const IMAGE_SIZE_STEP = 40
const IMAGE_SIZE_DEFAULT = 200

function ImageGallery({ mistakeId, images, onDelete, onView, onResize, busy }) {
  if (!images?.length) return null

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {images.map((img) => {
        const size = img.width ?? IMAGE_SIZE_DEFAULT
        return (
          <div
            key={img.url}
            style={{ width: size }}
            className="group relative shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/20"
          >
            <button type="button" onClick={() => onView(api.mistakeImageUrl(mistakeId, img.url))} className="block h-full w-full">
              <img src={api.mistakeImageUrl(mistakeId, img.url)} alt="" className="h-full w-full object-cover" />
            </button>
            <div className="absolute top-1 left-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => onResize(img.url, Math.max(IMAGE_SIZE_MIN, size - IMAGE_SIZE_STEP))}
                disabled={size <= IMAGE_SIZE_MIN}
                aria-label="Réduire l'image"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white disabled:opacity-40"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => onResize(img.url, Math.min(IMAGE_SIZE_MAX, size + IMAGE_SIZE_STEP))}
                disabled={size >= IMAGE_SIZE_MAX}
                aria-label="Agrandir l'image"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white disabled:opacity-40"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={() => onDelete(img.url)}
              disabled={busy}
              className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
      />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function AddPhotoButton({ onSelect, busy }) {
  return (
    <label
      aria-label="Ajouter une photo"
      className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/5 px-2 text-xs font-semibold text-slate-300 sm:px-3 ${busy ? 'opacity-60' : ''}`}
    >
      <CameraIcon />
      <span className="hidden sm:inline">Photo</span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        disabled={busy}
        onChange={(e) => {
          if (e.target.files.length) onSelect(Array.from(e.target.files))
          e.target.value = ''
        }}
        className="hidden"
      />
    </label>
  )
}

export function MistakesPage() {
  const [mistakes, setMistakes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [view, setView] = useState('list')
  const [description, setDescription] = useState('')
  const [planRespected, setPlanRespected] = useState(null)
  const [exitReason, setExitReason] = useState(null)
  const [emotion, setEmotion] = useState(null)
  const [lesson, setLesson] = useState('')
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDrafts, setEditDrafts] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState(null)

  useEffect(() => {
    if (!lightboxUrl) return
    function onKeyDown(e) {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxUrl])

  function load() {
    api
      .listMistakes()
      .then(setMistakes)
      .catch(() => setError('Impossible de charger tes erreurs'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd() {
    const trimmedDescription = description.trim()
    if (!trimmedDescription) return
    setSaving(true)
    setError('')
    try {
      const { id } = await api.createMistake({
        description: trimmedDescription,
        planRespected,
        exitReason,
        emotion,
        lesson: lesson.trim(),
      })
      for (const file of newFiles) {
        const dataBase64 = await fileToBase64(file)
        await api.addMistakeImage(id, file.type, dataBase64)
      }
      setDescription('')
      setPlanRespected(null)
      setExitReason(null)
      setEmotion(null)
      setLesson('')
      setNewFiles([])
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    setBusyId(id)
    try {
      await api.deleteMistake(id)
      setMistakes((current) => current.filter((x) => x.id !== id))
    } catch {
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function addImages(mistakeId, files) {
    setBusyId(mistakeId)
    setError('')
    try {
      for (const file of files) {
        const dataBase64 = await fileToBase64(file)
        const image = await api.addMistakeImage(mistakeId, file.type, dataBase64)
        setMistakes((current) =>
          current.map((m) => (m.id === mistakeId ? { ...m, images: [...(m.images ?? []), image] } : m)),
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  function startEdit(m) {
    setEditError('')
    setEditDrafts((current) => ({
      ...current,
      [m.id]: {
        description: m.description ?? m.title ?? '',
        planRespected: m.planRespected ?? null,
        exitReason: m.exitReason ?? null,
        emotion: m.emotion ?? null,
        lesson: m.lesson ?? m.text ?? '',
      },
    }))
    setEditingId(m.id)
  }

  function updateEditDraft(id, field, value) {
    setEditDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }))
  }

  function cancelEditEntry() {
    setEditError('')
    setEditingId(null)
  }

  async function saveEdit(id) {
    const draft = editDrafts[id]
    const trimmedDescription = draft.description.trim()
    if (!trimmedDescription) return
    setEditError('')
    setEditSaving(true)
    try {
      const payload = {
        description: trimmedDescription,
        planRespected: draft.planRespected,
        exitReason: draft.exitReason,
        emotion: draft.emotion,
        lesson: draft.lesson.trim(),
      }
      await api.updateMistake(id, payload)
      setMistakes((current) => current.map((m) => (m.id === id ? { ...m, ...payload } : m)))
      setEditingId(null)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setEditSaving(false)
    }
  }

  async function removeImage(mistakeId, url) {
    setBusyId(mistakeId)
    try {
      await api.deleteMistakeImage(mistakeId, url)
      setMistakes((current) =>
        current.map((m) => (m.id === mistakeId ? { ...m, images: m.images.filter((img) => img.url !== url) } : m)),
      )
    } catch {
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function resizeImage(mistakeId, url, width) {
    setMistakes((current) =>
      current.map((m) =>
        m.id === mistakeId
          ? { ...m, images: m.images.map((img) => (img.url === url ? { ...img, width } : img)) }
          : m,
      ),
    )
    try {
      await api.resizeMistakeImage(mistakeId, url, width)
    } catch (err) {
      setError(err.message)
    }
  }

  function renderMistakeCard(m) {
    return (
      <div key={m.id} className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/5 p-3">
        {editingId === m.id ? (
          <div
            className="flex flex-col gap-3"
            onPaste={(e) => {
              const pasted = imagesFromClipboard(e)
              if (pasted.length) addImages(m.id, pasted)
            }}
          >
            <input
              type="text"
              value={editDrafts[m.id]?.description ?? ''}
              onChange={(e) => updateEditDraft(m.id, 'description', e.target.value)}
              placeholder="Qu'est-ce qui s'est passé ?"
              className={FIELD_INPUT}
            />
            <ChoiceGroup
              label="As-tu respecté ton plan de trading ?"
              options={PLAN_OPTIONS}
              value={editDrafts[m.id]?.planRespected ?? null}
              onChange={(v) => updateEditDraft(m.id, 'planRespected', v)}
              disabled={editSaving}
            />
            <ChoiceGroup
              label="Pourquoi es-tu sorti(e) de la position ?"
              options={EXIT_OPTIONS}
              value={editDrafts[m.id]?.exitReason ?? null}
              onChange={(v) => updateEditDraft(m.id, 'exitReason', v)}
              disabled={editSaving}
            />
            <ChoiceGroup
              label="Quel était ton état émotionnel pendant le trade ?"
              options={EMOTION_OPTIONS}
              value={editDrafts[m.id]?.emotion ?? null}
              onChange={(v) => updateEditDraft(m.id, 'emotion', v)}
              disabled={editSaving}
            />
            <div>
              <p className="text-xs font-semibold text-slate-400">Qu'est-ce que tu retiens pour la prochaine fois ?</p>
              <textarea
                value={editDrafts[m.id]?.lesson ?? ''}
                onChange={(e) => updateEditDraft(m.id, 'lesson', e.target.value)}
                placeholder="Optionnel — colle une capture avec Cmd/Ctrl+V"
                rows={6}
                className={`${FIELD_INPUT} mt-1.5 min-h-40 w-full resize-none py-2`}
              />
            </div>
            {editError && <p className="text-xs text-red-400">{editError}</p>}
          </div>
        ) : (
          <>
            {m.description ?? m.title ? (
              <p className="text-lg font-bold text-white">{m.description ?? m.title}</p>
            ) : (
              <p className="text-lg font-bold text-slate-500 italic">Sans titre</p>
            )}
            {(m.planRespected || m.exitReason || m.emotion) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.planRespected && (
                  <Tag tone={findOption(PLAN_OPTIONS, m.planRespected).tone}>
                    {findOption(PLAN_OPTIONS, m.planRespected).label}
                  </Tag>
                )}
                {m.exitReason && (
                  <Tag tone={findOption(EXIT_OPTIONS, m.exitReason).tone}>
                    {findOption(EXIT_OPTIONS, m.exitReason).label}
                  </Tag>
                )}
                {m.emotion && (
                  <Tag tone={findOption(EMOTION_OPTIONS, m.emotion).tone}>
                    {findOption(EMOTION_OPTIONS, m.emotion).label}
                  </Tag>
                )}
              </div>
            )}
            {m.lesson || m.text ? (
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-slate-200">{m.lesson || m.text}</p>
            ) : (
              <p className="mt-2 text-sm text-amber-400/80 italic">Pas encore de note — clique sur "Modifier".</p>
            )}
          </>
        )}
        <ImageGallery
          mistakeId={m.id}
          images={m.images}
          onDelete={(url) => removeImage(m.id, url)}
          onView={setLightboxUrl}
          onResize={(url, width) => resizeImage(m.id, url, width)}
          busy={busyId === m.id}
        />
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-xs text-slate-500">{formatDate(m.createdAt)}</span>
          <div className="flex gap-2">
            {editingId === m.id ? (
              <>
                <button
                  type="button"
                  onClick={cancelEditEntry}
                  disabled={editSaving}
                  className="min-h-8 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-300 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => saveEdit(m.id)}
                  disabled={editSaving || !editDrafts[m.id]?.description?.trim()}
                  className="min-h-8 rounded-full bg-indigo-500/15 px-3 text-xs font-semibold text-indigo-300 disabled:opacity-60"
                >
                  {editSaving ? '...' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEdit(m)}
                  aria-label="Modifier"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/5 px-2 text-xs font-semibold text-slate-300 sm:px-3"
                >
                  <EditIcon />
                  <span className="hidden sm:inline">Modifier</span>
                </button>
                <AddPhotoButton onSelect={(files) => addImages(m.id, files)} busy={busyId === m.id} />
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={busyId === m.id}
                  aria-label="Supprimer"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-red-500/30 px-2 text-xs font-semibold text-red-400 disabled:opacity-60 sm:px-3"
                >
                  <TrashIcon />
                  <span className="hidden sm:inline">Supprimer</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${PAGE} lg:max-w-none`}>
      <h1 className={PAGE_TITLE}>Erreurs et succès</h1>
      <p className="text-sm text-slate-400">
        Note ce que tu fais de mal ou de bien sur un trade, avec une capture si besoin — ou capture juste le trade
        pendant la semaine et reviens mettre la note plus tard (ex : le week-end).
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setView('list')}
          className={`min-h-9 rounded-full px-4 text-sm font-semibold ${
            view === 'list' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300'
          }`}
        >
          Journal
        </button>
        <button
          type="button"
          onClick={() => setView('stats')}
          className={`min-h-9 rounded-full px-4 text-sm font-semibold ${
            view === 'stats' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-300'
          }`}
        >
          Stats
        </button>
      </div>

      {view === 'stats' && <MistakesStats mistakes={mistakes} />}

      {view === 'list' && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="min-h-10 self-start rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white"
        >
          + Ajouter un article
        </button>
      )}

      {view === 'list' && showForm && (
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
        <div
          className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 lg:w-1/2"
          onPaste={(e) => {
            const pasted = imagesFromClipboard(e)
            if (pasted.length) setNewFiles((current) => [...current, ...pasted])
          }}
        >
          <div>
            <p className="text-xs font-semibold text-slate-400">Qu'est-ce qui s'est passé ?</p>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex : Manque de patience sur une entrée H1"
              className={`${FIELD_INPUT} mt-1.5`}
            />
          </div>
          <ChoiceGroup
            label="As-tu respecté ton plan de trading ?"
            options={PLAN_OPTIONS}
            value={planRespected}
            onChange={setPlanRespected}
            disabled={saving}
          />
          <ChoiceGroup
            label="Pourquoi es-tu sorti(e) de la position ?"
            options={EXIT_OPTIONS}
            value={exitReason}
            onChange={setExitReason}
            disabled={saving}
          />
          <ChoiceGroup
            label="Quel était ton état émotionnel pendant le trade ?"
            options={EMOTION_OPTIONS}
            value={emotion}
            onChange={setEmotion}
            disabled={saving}
          />
          <div>
            <p className="text-xs font-semibold text-slate-400">Qu'est-ce que tu retiens pour la prochaine fois ?</p>
            <textarea
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              placeholder="Optionnel — colle une capture avec Cmd/Ctrl+V"
              rows={6}
              className={`${FIELD_INPUT} mt-1.5 min-h-40 w-full resize-none py-2`}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex min-h-8 cursor-pointer items-center rounded-full bg-white/5 px-3 text-xs font-semibold text-slate-300">
              + Photo{newFiles.length > 0 && ` (${newFiles.length})`}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={(e) => setNewFiles(Array.from(e.target.files))}
                className="hidden"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="min-h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-300 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving || !description.trim()}
                className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? '...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>

        {!loading && mistakes[0] && <div className="lg:w-1/2">{renderMistakeCard(mistakes[0])}</div>}
      </div>
      )}

      {view === 'list' && error && <p className="text-sm text-red-400">{error}</p>}
      {view === 'list' && loading && <p className="text-sm text-slate-400">Chargement...</p>}

      {view === 'list' && !loading && (
        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-4">
          {mistakes.length === 0 && <p className="text-sm text-slate-400">Rien noté pour l'instant.</p>}
          {(showForm ? mistakes.slice(1) : mistakes).map(renderMistakeCard)}
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="Fermer"
            className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl font-bold text-white"
          >
            ×
          </button>
          <img
            src={lightboxUrl}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  )
}
