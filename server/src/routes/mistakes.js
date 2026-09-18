import { Router } from 'express'
import { Readable } from 'node:stream'
import { del, get, put } from '@vercel/blob'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Captures d'écran de trades ratés — privées (pas de CDN public), servies
// uniquement via la route /view ci-dessous, derrière requireAuth comme le
// reste de l'app.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const CONTENT_TYPE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Formulaire guidé (remplace l'ancien titre/note libres) — les entrées créées
// avant cette migration n'ont que title/text, sans ces champs : GET renvoie
// les deux jeux de champs et le front retombe sur title/text s'ils manquent.
const PLAN_VALUES = new Set(['full', 'partial', 'no'])
const EXIT_VALUES = new Set(['sl', 'tp', 'manual_fear', 'manual_plan', 'other'])
const EMOTION_VALUES = new Set(['calm', 'stressed', 'impatient', 'confident', 'hesitant'])

// Taille d'affichage choisie à la main par l'utilisateur pour une image
// (boutons +/- dans la galerie) — bornes alignées sur IMAGE_SIZE_MIN/MAX
// côté front (src/pages/MistakesPage.jsx).
const IMAGE_WIDTH_MIN = 120
const IMAGE_WIDTH_MAX = 480

async function loadOwnedMistake(req, res) {
  const ref = db.collection('mistakes').doc(req.params.id)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    res.status(404).json({ error: 'Erreur introuvable' })
    return null
  }
  return { ref, data: doc.data() }
}

router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('mistakes').where('userId', '==', req.userId).get()
  const mistakes = snapshot.docs
    .map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        title: data.title ?? null,
        text: data.text ?? null,
        description: data.description ?? null,
        planRespected: data.planRespected ?? null,
        exitReason: data.exitReason ?? null,
        emotion: data.emotion ?? null,
        lesson: data.lesson ?? null,
        createdAt: data.createdAt,
        images: data.images ?? [],
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  res.json(mistakes)
})

router.post('/', requireAuth, async (req, res) => {
  const description = (req.body?.description ?? '').trim()
  if (!description) return res.status(400).json({ error: "Décris ce qui s'est passé" })

  const planRespected = PLAN_VALUES.has(req.body?.planRespected) ? req.body.planRespected : null
  const exitReason = EXIT_VALUES.has(req.body?.exitReason) ? req.body.exitReason : null
  const emotion = EMOTION_VALUES.has(req.body?.emotion) ? req.body.emotion : null
  const lesson = (req.body?.lesson ?? '').trim()

  const docRef = await db.collection('mistakes').add({
    userId: req.userId,
    description,
    planRespected,
    exitReason,
    emotion,
    lesson,
    createdAt: Date.now(),
    images: [],
  })
  res.status(201).json({ id: docRef.id })
})

router.patch('/:id', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  const { description, planRespected, exitReason, emotion, lesson } = req.body ?? {}
  if ([description, planRespected, exitReason, emotion, lesson].every((v) => v === undefined)) {
    return res.status(400).json({ error: 'Rien à mettre à jour' })
  }

  const updates = {}
  if (description !== undefined) {
    const trimmed = description.trim()
    if (!trimmed) return res.status(400).json({ error: "Décris ce qui s'est passé" })
    updates.description = trimmed
  }
  if (planRespected !== undefined) updates.planRespected = PLAN_VALUES.has(planRespected) ? planRespected : null
  if (exitReason !== undefined) updates.exitReason = EXIT_VALUES.has(exitReason) ? exitReason : null
  if (emotion !== undefined) updates.emotion = EMOTION_VALUES.has(emotion) ? emotion : null
  if (lesson !== undefined) updates.lesson = lesson.trim()

  await owned.ref.update(updates)
  res.status(204).end()
})

router.delete('/:id', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  const images = owned.data.images ?? []
  await Promise.all(images.map((img) => del(img.url).catch(() => {})))
  await owned.ref.delete()
  res.status(204).end()
})

router.post('/:id/images', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  const { contentType, dataBase64 } = req.body ?? {}
  const extension = CONTENT_TYPE_EXTENSIONS[contentType]
  if (!extension) {
    return res.status(400).json({ error: "Format d'image non supporté (png/jpeg/webp/gif)" })
  }
  if (typeof dataBase64 !== 'string' || !dataBase64) {
    return res.status(400).json({ error: 'Image manquante' })
  }

  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Image trop lourde (max 8 Mo)' })
  }

  const pathname = `mistakes/${req.userId}/${req.params.id}/${Date.now()}.${extension}`
  const blob = await put(pathname, buffer, { access: 'private', contentType })

  const image = { url: blob.url, uploadedAt: Date.now() }
  await owned.ref.update({ images: [...(owned.data.images ?? []), image] })
  res.status(201).json(image)
})

router.patch('/:id/images', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  const { url, width } = req.body ?? {}
  const images = owned.data.images ?? []
  const index = images.findIndex((img) => img.url === url)
  if (index === -1) return res.status(404).json({ error: 'Image introuvable' })
  if (typeof width !== 'number' || Number.isNaN(width)) {
    return res.status(400).json({ error: 'Taille invalide' })
  }

  const clampedWidth = Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, width))
  const updated = [...images]
  updated[index] = { ...updated[index], width: clampedWidth }
  await owned.ref.update({ images: updated })
  res.status(204).end()
})

router.get('/:id/images/view', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  const url = req.query.url
  const images = owned.data.images ?? []
  if (typeof url !== 'string' || !images.some((img) => img.url === url)) {
    return res.status(404).json({ error: 'Image introuvable' })
  }

  const result = await get(url, { access: 'private' })
  if (!result || result.statusCode !== 200) {
    return res.status(404).json({ error: 'Image introuvable' })
  }

  res.setHeader('Content-Type', result.blob.contentType)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  Readable.fromWeb(result.stream).pipe(res)
})

router.delete('/:id/images', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  const url = req.body?.url
  const images = owned.data.images ?? []
  const remaining = images.filter((img) => img.url !== url)
  if (remaining.length === images.length) {
    return res.status(404).json({ error: 'Image introuvable' })
  }

  await del(url)
  await owned.ref.update({ images: remaining })
  res.status(204).end()
})

export default router
