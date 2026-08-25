import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import authRouter from './routes/auth.js'
import accountRouter from './routes/account.js'
import pricesRouter from './routes/prices.js'
import candlesRouter from './routes/candles.js'
import tasksRouter from './routes/tasks.js'
import positionsRouter from './routes/positions.js'
import tradesRouter from './routes/trades.js'
import reportsRouter from './routes/reports.js'
import pushRouter from './routes/push.js'
import notifyRouter from './routes/notify.js'
import setOrderRouter from './routes/setOrder.js'
import settingsRouter from './routes/settings.js'
import marketRecapRouter from './routes/marketRecap.js'
import mistakesRouter from './routes/mistakes.js'
import { isAllowedOrigin } from './lib/origin.js'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET manquant dans .env')
}

const app = express()

// Limite relevée par rapport au défaut (100kb) : les captures d'écran de
// trades envoyées en base64 (voir mistakes.js) dépassent largement ça.
app.use(express.json({ limit: '15mb' }))
app.use(cookieParser())
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) return callback(null, true)
      return callback(new Error('Origin non autorisée'))
    },
    credentials: true,
  }),
)

app.use('/api/auth', authRouter)
app.use('/api/account', accountRouter)
app.use('/api/prices', pricesRouter)
app.use('/api/candles', candlesRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/positions', positionsRouter)
app.use('/api/trades', tradesRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/push', pushRouter)
app.use('/api/notify', notifyRouter)
app.use('/api/set-order', setOrderRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/market-recap', marketRecapRouter)
app.use('/api/mistakes', mistakesRouter)

app.get('/api/health', (req, res) => res.json({ ok: true }))

export default app
