import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { parsePageLimit } from '../../shared/utils/pagination.js'
import { pccesImportService } from './pcces-import.service.js'

type ReqWithFile = Request & { file?: Express.Multer.File }

function getProjectId(req: Request): string {
  const id = req.params.projectId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少專案 ID')
}

function getImportId(req: Request): string {
  const id = req.params.importId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少匯入 ID')
}

export const pccesImportController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const data = await pccesImportService.list(projectId, req.user)
    res.status(200).json({ data })
  },

  async upload(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const file = (req as ReqWithFile).file
    if (!file?.buffer) throw new AppError(400, 'BAD_REQUEST', '請上傳 XML 檔案')
    const data = await pccesImportService.uploadFromBuffer(
      projectId,
      file.buffer,
      file.originalname || 'import.xml',
      file.mimetype || 'application/xml',
      req.user
    )
    res.status(201).json({ data })
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const importId = getImportId(req)
    const data = await pccesImportService.getById(projectId, importId, req.user)
    res.status(200).json({ data })
  },

  async listItems(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const importId = getImportId(req)
    const rawAll = req.query.all
    const loadAll = rawAll === '1' || rawAll === 'true'
    const parsed = parsePageLimit(req)
    const { page, limit, skip } = loadAll
      ? { page: 1, limit: 0, skip: 0 }
      : parsed
    const rawKind = req.query.itemKind
    const itemKind =
      rawKind === 'general' || rawKind === 'mainItem' ? rawKind : undefined
    const result = await pccesImportService.listItems(projectId, importId, req.user, {
      page,
      limit,
      skip,
      itemKind,
      all: loadAll,
    })
    res.status(200).json({
      data: { import: result.import, items: result.items },
      meta: result.meta,
    })
  },

  async delete(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = getProjectId(req)
    const importId = getImportId(req)
    await pccesImportService.softDelete(projectId, importId, req.user)
    res.status(200).json({ data: { ok: true } })
  },
}
