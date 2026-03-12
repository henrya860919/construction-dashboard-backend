import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { userController } from '../modules/user/index.js'

export const usersRouter = Router()

/** GET /api/v1/users — 人員列表（分頁；之後依登入者權限過濾） */
usersRouter.get('/', asyncHandler(userController.list.bind(userController)))

/** GET /api/v1/users/:id — 單一人員（不回傳密碼） */
usersRouter.get('/:id', asyncHandler(userController.getById.bind(userController)))

/** POST /api/v1/users — 新增人員（之後需驗證權限） */
usersRouter.post('/', asyncHandler(userController.create.bind(userController)))
