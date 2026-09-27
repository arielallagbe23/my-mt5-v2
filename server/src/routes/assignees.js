import { Router } from 'express'
import { db } from '../firebase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const MAX_PSEUDO_LENGTH = 40

async function loadOwnedAssignee(req, res) {
  const ref = db.collection('assignees').doc(req.params.id)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== req.userId) {
    res.status(404).json({ error: 'Assigné introuvable' })
    return null
  }
  return { ref, data: doc.data() }
}

router.get('/', requireAuth, async (req, res) => {
  const snapshot = await db.collection('assignees').where('userId', '==', req.userId).get()
  const assignees = snapshot.docs
    .map((doc) => ({ id: doc.id, pseudo: doc.data().pseudo, createdAt: doc.data().createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt)
  res.json(assignees)
})

router.post('/', requireAuth, async (req, res) => {
  const pseudo = (req.body?.pseudo ?? '').trim()
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' })
  if (pseudo.length > MAX_PSEUDO_LENGTH) {
    return res.status(400).json({ error: `Pseudo trop long (max ${MAX_PSEUDO_LENGTH} caractères)` })
  }

  const docRef = await db.collection('assignees').add({
    userId: req.userId,
    pseudo,
    createdAt: Date.now(),
  })
  res.status(201).json({ id: docRef.id, pseudo, createdAt: Date.now() })
})

router.patch('/:id', requireAuth, async (req, res) => {
  const owned = await loadOwnedAssignee(req, res)
  if (!owned) return

  const pseudo = (req.body?.pseudo ?? '').trim()
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' })
  if (pseudo.length > MAX_PSEUDO_LENGTH) {
    return res.status(400).json({ error: `Pseudo trop long (max ${MAX_PSEUDO_LENGTH} caractères)` })
  }

  await owned.ref.update({ pseudo })
  res.status(204).end()
})

router.delete('/:id', requireAuth, async (req, res) => {
  const owned = await loadOwnedAssignee(req, res)
  if (!owned) return

  await owned.ref.delete()
  res.status(204).end()
})

export default router
