import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/error-handler.js'
import { apiRouter } from './routes/index.js'

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? '*',
  credentials: true,
}))
app.use(express.json())

app.use('/api/v1', apiRouter)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use(errorHandler)

export { app }
