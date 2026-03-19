import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { errorHandler } from './middleware/error-handler.js'
import { apiRouter } from './routes/index.js'

const app = express()

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
)

// 正式環境未設定 CORS_ORIGIN 時不允許任何 cross-origin，強制在 .env 設定
const corsOrigin = process.env.CORS_ORIGIN?.trim()
const isProduction = process.env.NODE_ENV === 'production'
const origin =
  corsOrigin != null && corsOrigin !== ''
    ? corsOrigin
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : isProduction
      ? false
      : '*'
app.use(
  cors({
    origin,
    credentials: true,
  })
)
app.use(express.json())

app.use('/api/v1', apiRouter)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use(errorHandler)

export { app }
