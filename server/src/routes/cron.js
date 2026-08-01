import { Router } from 'express'
import { db } from '../firebase.js'

const router = Router()

router.get('/hello', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const ranAt = new Date().toISOString()
  console.log('Cron hello world exécuté à', ranAt)

  await db.collection('cron_runs').doc('hello').set({ ranAt })

  res.json({ ok: true, message: 'Hello world', ranAt })
})

export default router
