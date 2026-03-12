import type { Request, Response } from 'express'
import { createUserSchema } from '../../schemas/user.js'
import { parsePageLimit } from '../../shared/utils/pagination.js'
import { userService } from './user.service.js'

export const userController = {
  async list(req: Request, res: Response) {
    const { page, limit, skip } = parsePageLimit(req)
    const { list, total } = await userService.list({ page, limit, skip })
    res.status(200).json({
      data: list,
      meta: { page, limit, total },
    })
  },

  async getById(req: Request, res: Response) {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少使用者 id' } })
      return
    }
    const user = await userService.getById(id)
    res.status(200).json({ data: user })
  },

  async create(req: Request, res: Response) {
    const parsed = createUserSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '欄位驗證失敗',
          details: parsed.error.flatten(),
        },
      })
      return
    }
    const user = await userService.create(parsed.data)
    res.status(201).json({ data: user })
  },
}
