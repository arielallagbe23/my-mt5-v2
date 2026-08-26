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
        text: data.text,
        createdAt: data.createdAt,
        images: data.images ?? [],
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  res.json(mistakes)
})

router.post('/', requireAuth, async (req, res) => {
  const text = (req.body?.text ?? '').trim()
  if (!text) return res.status(400).json({ error: 'Texte requis' })
  const title = (req.body?.title ?? '').trim() || null

  const docRef = await db.collection('mistakes').add({
    userId: req.userId,
    title,
    text,
    createdAt: Date.now(),
    images: [],
  })
  res.status(201).json({ id: docRef.id })
})

router.patch('/:id', requireAuth, async (req, res) => {
  const owned = await loadOwnedMistake(req, res)
  if (!owned) return

  if (req.body?.title === undefined) return res.status(400).json({ error: 'Rien à mettre à jour' })

  await owned.ref.update({ title: (req.body.title ?? '').trim() || null })
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
