import type { Request, Response } from 'express'
import { createProjectSchema } from '../../schemas/project.js'
import { parsePageLimit } from '../../shared/utils/pagination.js'
import { projectService } from './project.service.js'

export const projectController = {
  async list(req: Request, res: Response) {
    const { page, limit, skip } = parsePageLimit(req)
    const { list, total } = await projectService.list({ page, limit, skip })
    res.status(200).json({
      data: list,
      meta: { page, limit, total },
    })
  },

  async getById(req: Request, res: Response) {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少專案 id' } })
      return
    }
    const project = await projectService.getById(id)
    res.status(200).json({ data: project })
  },

  async create(req: Request, res: Response) {
    const parsed = createProjectSchema.safeParse(req.body)
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
    const project = await projectService.create(parsed.data)
    res.status(201).json({ data: project })
  },
}
