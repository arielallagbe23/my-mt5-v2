import { useEffect, useRef, useState } from 'react'

const MIN_CROP_SIZE = 40
const HANDLES = ['nw', 'ne', 'sw', 'se']

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// Charge l'image en Blob (au lieu d'un simple <img src={url}>) pour éviter
// tout risque de canvas "taint" par une image cross-origin (dev : front et
// API sur des ports différents) — un blob local n'a pas ce problème, quel
// que soit l'environnement.
function useImageBlobUrl(src) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let url = null
    setObjectUrl(null)
    setError('')
    fetch(src, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Image introuvable')
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de charger l'image")
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])

  return { objectUrl, error }
}

export function ImageCropModal({ src, onCancel, onConfirm, saving }) {
  const { objectUrl, error: loadError } = useImageBlobUrl(src)
  const imgRef = useRef(null)
  const [natural, setNatural] = useState(null)
  const [displayed, setDisplayed] = useState(null)
  const [rect, setRect] = useState(null)
  const dragRef = useRef(null)
  const displayedRef = useRef(null)

  function onImageLoad() {
    const el = imgRef.current
    if (!el) return
    setNatural({ width: el.naturalWidth, height: el.naturalHeight })
    const size = { width: el.clientWidth, height: el.clientHeight }
    setDisplayed(size)
    const insetX = size.width * 0.1
    const insetY = size.height * 0.1
    setRect({
      x: insetX,
      y: insetY,
      w: size.width - insetX * 2,
      h: size.height - insetY * 2,
    })
  }

  useEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  // Écouteurs attachés une seule fois (montage) — dragRef.current porte
  // l'état de la session de drag en cours ; sans lui, mettre startDrag()
  // dans les deps recréerait les listeners à chaque render sans jamais
  // capter le "pointerdown" qui vient de les déclencher.
  useEffect(() => {
    function onMove(e) {
      const drag = dragRef.current
      const size = displayedRef.current
      if (!drag || !size) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY

      let { x, y, w, h } = drag.startRect
      if (drag.mode === 'move') {
        x = clamp(drag.startRect.x + dx, 0, size.width - w)
        y = clamp(drag.startRect.y + dy, 0, size.height - h)
      } else {
        if (drag.mode.includes('w')) {
          const nx = clamp(drag.startRect.x + dx, 0, drag.startRect.x + drag.startRect.w - MIN_CROP_SIZE)
          w = drag.startRect.w - (nx - drag.startRect.x)
          x = nx
        }
        if (drag.mode.includes('e')) {
          w = clamp(drag.startRect.w + dx, MIN_CROP_SIZE, size.width - drag.startRect.x)
        }
        if (drag.mode.includes('n')) {
          const ny = clamp(drag.startRect.y + dy, 0, drag.startRect.y + drag.startRect.h - MIN_CROP_SIZE)
          h = drag.startRect.h - (ny - drag.startRect.y)
          y = ny
        }
        if (drag.mode.includes('s')) {
          h = clamp(drag.startRect.h + dy, MIN_CROP_SIZE, size.height - drag.startRect.y)
        }
      }
      setRect({ x, y, w, h })
    }

    function onUp() {
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  function startDrag(e, mode) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startRect: rect }
  }

  function handleConfirm() {
    if (!rect || !natural || !displayed) return
    const scaleX = natural.width / displayed.width
    const scaleY = natural.height / displayed.height
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.w * scaleX))
    canvas.height = Math.max(1, Math.round(rect.h * scaleY))
    const ctx = canvas.getContext('2d')
    ctx.drawImage(
      imgRef.current,
      rect.x * scaleX,
      rect.y * scaleY,
      rect.w * scaleX,
      rect.h * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob)
    }, 'image/png')
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4">
      <div className="relative flex max-h-[70vh] max-w-full items-center justify-center">
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}
        {objectUrl && (
          <>
            <img
              ref={imgRef}
              src={objectUrl}
              alt=""
              onLoad={onImageLoad}
              className="max-h-[70vh] max-w-full rounded-lg select-none"
              draggable={false}
            />
            {rect && (
              <div
                onPointerDown={(e) => startDrag(e, 'move')}
                className="absolute cursor-move touch-none border-2 border-indigo-400 bg-indigo-400/10"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              >
                {HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => startDrag(e, h)}
                    className={`absolute h-3.5 w-3.5 touch-none rounded-full border border-white bg-indigo-500 ${
                      h.includes('n') ? '-top-1.5' : '-bottom-1.5'
                    } ${h.includes('w') ? '-left-1.5 cursor-nwse-resize' : '-right-1.5 cursor-nesw-resize'}`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-300 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving || !rect}
          className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? '...' : 'Rogner'}
        </button>
      </div>
    </div>
  )
}
