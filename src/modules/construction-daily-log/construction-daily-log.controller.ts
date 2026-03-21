import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { parsePageLimit } from '../../shared/utils/pagination.js'
import { constructionDailyLogService } from './construction-daily-log.service.js'

function getProjectId(req: Request): string {
  const id = req.params.projectId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少專案 ID')
}

function getLogId(req: Request): string {
  const id = req.params.logId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少日誌 ID')
}

export const constructionDailyLogController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const { page, limit } = parsePageLimit(req)
    const result = await constructionDailyLogService.list(projectId, req.user, page, limit)
    res.status(200).json({ data: result.data, meta: result.meta })
  },

  async defaults(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const data = await constructionDailyLogService.getFormDefaults(projectId, req.user)
    res.status(200).json({ data })
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const logId = getLogId(req)
    const data = await constructionDailyLogService.getById(projectId, logId, req.user)
    res.status(200).json({ data })
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const data = await constructionDailyLogService.create(projectId, req.user, req.body)
    res.status(201).json({ data })
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const logId = getLogId(req)
    const data = await constructionDailyLogService.update(projectId, logId, req.user, req.body)
    res.status(200).json({ data })
  },

  async delete(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const logId = getLogId(req)
    const data = await constructionDailyLogService.delete(projectId, logId, req.user)
    res.status(200).json({ data })
  },
}
