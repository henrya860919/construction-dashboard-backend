import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { projectController } from '../modules/project/index.js'

export const projectsRouter = Router()

/** GET /api/v1/projects — 專案列表（分頁；之後依登入者權限過濾） */
projectsRouter.get('/', asyncHandler(projectController.list.bind(projectController)))

/** GET /api/v1/projects/:id — 單一專案 */
projectsRouter.get('/:id', asyncHandler(projectController.getById.bind(projectController)))

/** POST /api/v1/projects — 新增專案（之後需驗證權限） */
projectsRouter.post('/', asyncHandler(projectController.create.bind(projectController)))
