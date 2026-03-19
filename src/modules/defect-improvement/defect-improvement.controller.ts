import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { defectImprovementService } from './defect-improvement.service.js'
import {
  createDefectImprovementSchema,
  updateDefectImprovementSchema,
  createDefectExecutionRecordSchema,
} from '../../schemas/defect-improvement.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

function getProjectId(req: Request): string {
  const id = req.params.projectId
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少專案 ID')
}

function getId(req: Request, param = 'id'): string {
  const id = req.params[param]
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', `缺少參數 ${param}`)
}

function toDefectDto(row: { id: string; projectId: string; description: string; discoveredBy: string; priority: string; floor: string | null; location: string | null; status: string; createdAt: Date; updatedAt: Date }, photos?: { id: string; fileName: string; fileSize: number; mimeType: string; createdAt: string; url: string }[]) {
  return {
    id: row.id,
    projectId: row.projectId,
    description: row.description,
    discoveredBy: row.discoveredBy,
    priority: row.priority,
    floor: row.floor,
    location: row.location,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(photos && { photos }),
  }
}

function toRecordDto(row: {
  id: string
  defectId: string
  content: string
  recordedById: string | null
  createdAt: Date
  recordedBy: { id: string; name: string | null; email: string } | null
}, photos?: { id: string; fileName: string; fileSize: number; mimeType: string; createdAt: string; url: string }[]) {
  return {
    id: row.id,
    defectId: row.defectId,
    content: row.content,
    recordedById: row.recordedById,
    recordedBy: row.recordedBy
      ? { id: row.recordedBy.id, name: row.recordedBy.name, email: row.recordedBy.email }
      : null,
    createdAt: row.createdAt.toISOString(),
    ...(photos && { photos }),
  }
}

export const defectImprovementController = {
  async list(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
    const { items, total } = await defectImprovementService.list(
      projectId,
      { status, page, limit },
      user
    )
    res.status(200).json({
      data: items.map((row) => toDefectDto(row)),
      meta: { page, limit, total },
    })
  },

  async getById(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const defectId = getId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const result = await defectImprovementService.getById(projectId, defectId, user)
    if (!result) {
      throw new AppError(404, 'NOT_FOUND', '找不到該缺失改善')
    }
    const { photos, ...defect } = result
    res.status(200).json({ data: toDefectDto(defect, photos) })
  },

  async create(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const parsed = createDefectImprovementSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const item = await defectImprovementService.create(projectId, parsed.data, user)
    res.status(201).json({ data: toDefectDto(item) })
  },

  async update(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const defectId = getId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const parsed = updateDefectImprovementSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const item = await defectImprovementService.update(projectId, defectId, parsed.data, user)
    res.status(200).json({ data: toDefectDto(item) })
  },

  async delete(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const defectId = getId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    await defectImprovementService.delete(projectId, defectId, user)
    res.status(204).send()
  },

  async listRecords(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const defectId = getId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const records = await defectImprovementService.listRecords(defectId, projectId, user)
    res.status(200).json({
      data: records.map((r) => toRecordDto(r, r.photos)),
    })
  },

  async createRecord(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const defectId = getId(req)
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const parsed = createDefectExecutionRecordSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const record = await defectImprovementService.createRecord(projectId, defectId, parsed.data, user)
    res.status(201).json({ data: toRecordDto(record) })
  },

  async getRecord(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const defectId = getId(req)
    const recordId = getId(req, 'recordId')
    const user = req.user as AuthUser | undefined
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const result = await defectImprovementService.getRecordById(projectId, defectId, recordId, user)
    if (!result) {
      throw new AppError(404, 'NOT_FOUND', '找不到該執行紀錄')
    }
    res.status(200).json({ data: toRecordDto(result, result.photos) })
  },
}
