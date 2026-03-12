import { Router } from 'express'
import { authMiddleware, requireAdmin, requirePlatformAdmin } from '../middleware/auth.js'
import { authRouter } from './auth.js'
import { projectsRouter } from './projects.js'
import { usersRouter } from './users.js'
import { adminRouter } from './admin.js'
import { platformAdminRouter } from './platform-admin.js'

export const apiRouter = Router()

apiRouter.get('/', (_req, res) => {
  res.json({ data: { message: 'Construction Dashboard API v1' } })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/projects', authMiddleware, projectsRouter)
apiRouter.use('/users', authMiddleware, usersRouter)
apiRouter.use('/admin', authMiddleware, requireAdmin, adminRouter)
apiRouter.use('/platform-admin', authMiddleware, requirePlatformAdmin, platformAdminRouter)
