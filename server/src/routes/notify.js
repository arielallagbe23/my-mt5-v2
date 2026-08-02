import { Router } from 'express'
import { sendPushToAll } from '../lib/push.js'

const router = Router()

// Appelé par le VPS (jamais par le frontend) quand une tâche vient d'être
// évaluée ou exécutée — même secret que /api/cron/hello.
router.post('/', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { title, body } = req.body ?? {}
  if (typeof title !== 'string' || typeof body !== 'string') {
    return res.status(400).json({ error: 'title et body requis' })
  }

  await sendPushToAll({ title, body })
  res.json({ ok: true })
})

export default router
