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
    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {images.map((img) => (
        <div key={img.url} className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <a href={api.mistakeImageUrl(mistakeId, img.url)} target="_blank" rel="noreferrer">
            <img src={api.mistakeImageUrl(mistakeId, img.url)} alt="" className="h-full w-full object-cover" />
          </a>
          <button
            type="button"
            onClick={() => onDelete(img.url)}
            disabled={busy}
            className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

function AddPhotoButton({ onSelect, busy }) {
  return (
    <label
      className={`inline-flex min-h-8 cursor-pointer items-center rounded-full bg-white/5 px-3 text-xs font-semibold text-slate-300 ${busy ? 'opacity-60' : ''}`}
    >
      + Photo
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
      const { id } = await api.createMistake(trimmed)
      for (const file of newFiles) {
        const dataBase64 = await fileToBase64(file)
        await api.addMistakeImage(id, file.type, dataBase64)
      }
      setText('')
      setNewFiles([])
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleResolved(m) {
    setBusyId(m.id)
    try {
      await api.resolveMistake(m.id, !m.resolved)
      setMistakes((current) => current.map((x) => (x.id === m.id ? { ...x, resolved: !m.resolved } : x)))
    } catch {
      load()
    } finally {
      setBusyId(null)
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

  const active = mistakes.filter((m) => !m.resolved)
  const resolved = mistakes.filter((m) => m.resolved)

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Mes erreurs</h1>
      <p className="text-sm text-slate-400">
        Note ce que tu fais de mal, avec une capture du trade si besoin — ce qui n'est pas résolu s'affiche sur la
        page d'accueil pour te le rappeler.
      </p>

      <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
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
        <>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
              En cours {active.length > 0 && `(${active.length})`}
            </p>
            {active.length === 0 && <p className="text-sm text-slate-400">Rien en cours — bien joué.</p>}
            {active.map((m) => (
              <div key={m.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-sm text-white">{m.text}</p>
                <ImageGallery mistakeId={m.id} images={m.images} onDelete={(url) => removeImage(m.id, url)} busy={busyId === m.id} />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{formatDate(m.createdAt)}</span>
                  <div className="flex gap-2">
                    <AddPhotoButton onSelect={(files) => addImages(m.id, files)} busy={busyId === m.id} />
                    <button
                      type="button"
                      onClick={() => toggleResolved(m)}
                      disabled={busyId === m.id}
                      className="min-h-8 rounded-full bg-indigo-500/15 px-3 text-xs font-semibold text-indigo-300 disabled:opacity-60"
                    >
                      Marquer résolu
                    </button>
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
              </div>
            ))}
          </div>

          {resolved.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">Résolues ({resolved.length})</p>
              {resolved.map((m) => (
                <div key={m.id} className="rounded-2xl border border-white/10 bg-white/5 p-3 opacity-60">
                  <p className="text-sm text-slate-300 line-through">{m.text}</p>
                  <ImageGallery mistakeId={m.id} images={m.images} onDelete={(url) => removeImage(m.id, url)} busy={busyId === m.id} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">{formatDate(m.createdAt)}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => toggleResolved(m)}
                        disabled={busyId === m.id}
                        className="min-h-8 rounded-full bg-white/5 px-3 text-xs font-semibold text-slate-300 disabled:opacity-60"
                      >
                        Réactiver
                      </button>
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
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
