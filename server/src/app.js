import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import authRouter from './routes/auth.js'
import accountRouter from './routes/account.js'
import pricesRouter from './routes/prices.js'
import candlesRouter from './routes/candles.js'
import ordersRouter from './routes/orders.js'
import tasksRouter from './routes/tasks.js'
import cronRouter from './routes/cron.js'
import pushRouter from './routes/push.js'
import { isAllowedOrigin } from './lib/origin.js'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET manquant dans .env')
}

const app = express()

app.use(express.json())
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
app.use('/api/orders', ordersRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/cron', cronRouter)
app.use('/api/push', pushRouter)

app.get('/api/health', (req, res) => res.json({ ok: true }))

export default app
