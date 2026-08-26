import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { PAGE, PAGE_TITLE, FIELD_INPUT } from '../lib/layout'

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

function ImageGallery({ mistakeId, images, onDelete, busy }) {
  if (!images?.length) return null
  return (
    <div className="mt-4 flex flex-col gap-2">
      {images.map((img) => (
        <div key={img.url} className="group relative w-full overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <a href={api.mistakeImageUrl(mistakeId, img.url)} target="_blank" rel="noreferrer">
            <img src={api.mistakeImageUrl(mistakeId, img.url)} alt="" className="w-full" />
          </a>
          <button
            type="button"
            onClick={() => onDelete(img.url)}
            disabled={busy}
            className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export function MistakesPage() {
  const [mistakes, setMistakes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [newFiles, setNewFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

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
    const trimmed = text.trim()
    if (!trimmed) return
    setSaving(true)
    setError('')
    try {
      const { id } = await api.createMistake(title.trim(), trimmed)
      for (const file of newFiles) {
        const dataBase64 = await fileToBase64(file)
        await api.addMistakeImage(id, file.type, dataBase64)
      }
      setTitle('')
      setText('')
      setNewFiles([])
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

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Erreurs et succès</h1>
      <p className="text-sm text-slate-400">
        Note ce que tu fais de mal ou de bien sur un trade, avec une capture si besoin.
      </p>

      <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre (ex : Manque de patience)"
          className={FIELD_INPUT}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex : je suis rentré trop tôt, avant que le retest confirme la zone"
          rows={3}
          className={`${FIELD_INPUT} min-h-20 resize-none py-2`}
        />
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
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !text.trim()}
            className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '...' : 'Ajouter'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Chargement...</p>}

      {!loading && (
        <div className="flex flex-col gap-2">
          {mistakes.length === 0 && <p className="text-sm text-slate-400">Rien noté pour l'instant.</p>}
          {mistakes.map((m) => (
            <div key={m.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              {m.title && <p className="text-lg font-bold text-white">{m.title}</p>}
              <p className="mt-2 text-sm text-white">{m.text}</p>
              <ImageGallery mistakeId={m.id} images={m.images} onDelete={(url) => removeImage(m.id, url)} busy={busyId === m.id} />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{formatDate(m.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={busyId === m.id}
                  className="min-h-8 rounded-full border border-red-500/30 px-3 text-xs font-semibold text-red-400 disabled:opacity-60"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
