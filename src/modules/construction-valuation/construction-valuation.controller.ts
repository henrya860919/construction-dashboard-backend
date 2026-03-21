import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { parsePageLimit } from '../../shared/utils/pagination.js'
import { constructionValuationService } from './construction-valuation.service.js'

function getProjectId(req: Request): string {
  const id = req.params.projectId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少專案 ID')
}

function getValuationId(req: Request): string {
  const id = req.params.valuationId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少估驗 ID')
}

export const constructionValuationController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const { page, limit } = parsePageLimit(req)
    const result = await constructionValuationService.list(projectId, req.user, page, limit)
    res.status(200).json({ data: result.data, meta: result.meta })
  },

  async pccesLinePicker(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const excludeValuationId =
      typeof req.query.excludeValuationId === 'string' && req.query.excludeValuationId.length > 0
        ? req.query.excludeValuationId
        : undefined
    const asOfDate =
      typeof req.query.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOfDate.trim())
        ? req.query.asOfDate.trim()
        : undefined
    const data = await constructionValuationService.getPccesLinePicker(
      projectId,
      req.user,
      excludeValuationId,
      asOfDate
    )
    res.status(200).json({ data })
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const valuationId = getValuationId(req)
    const data = await constructionValuationService.getById(projectId, valuationId, req.user)
    res.status(200).json({ data })
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const data = await constructionValuationService.create(projectId, req.user, req.body)
    res.status(201).json({ data })
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const valuationId = getValuationId(req)
    const data = await constructionValuationService.update(projectId, valuationId, req.user, req.body)
    res.status(200).json({ data })
  },

  async delete(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const valuationId = getValuationId(req)
    const data = await constructionValuationService.delete(projectId, valuationId, req.user)
    res.status(200).json({ data })
  },
}
