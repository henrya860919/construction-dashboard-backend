import { Router } from 'express'

export const apiRouter = Router()

apiRouter.get('/', (_req, res) => {
  res.json({ data: { message: 'Construction Dashboard API v1' } })
})
