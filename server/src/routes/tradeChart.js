import { Router } from 'express'
import { put } from '@vercel/blob'
import { db } from '../firebase.js'

const router = Router()

// Graphiques de trade auto-générés par le VPS (mt5-vps/trade_chart.py) et
// attachés à une entrée du journal (mistakes) — jamais appelé par le
// frontend, même secret que /api/notify. Le VPS n'a pas le token Blob, donc
// c'est cette route qui fait l'upload et écrit la référence dans Firestore
// (même format { url, uploadedAt } que les images ajoutées à la main,
// voir mistakes.js).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

router.post('/upload', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { mistakeId, contentType, dataBase64 } = req.body ?? {}
  if (contentType !== 'image/png') {
    return res.status(400).json({ error: 'Format non supporté (png uniquement)' })
  }
  if (typeof mistakeId !== 'string' || !mistakeId) {
    return res.status(400).json({ error: 'mistakeId requis' })
  }
  if (typeof dataBase64 !== 'string' || !dataBase64) {
    return res.status(400).json({ error: 'Image manquante' })
  }

  const ref = db.collection('mistakes').doc(mistakeId)
  const doc = await ref.get()
  if (!doc.exists) {
    return res.status(404).json({ error: 'Entrée introuvable' })
  }

  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Image trop lourde (max 8 Mo)' })
  }

  const pathname = `mistakes/${doc.data().userId}/${mistakeId}/${Date.now()}.png`
  const blob = await put(pathname, buffer, { access: 'private', contentType })

  const image = { url: blob.url, uploadedAt: Date.now() }
  await ref.update({ images: [...(doc.data().images ?? []), image] })
  res.status(201).json(image)
})

export default router
