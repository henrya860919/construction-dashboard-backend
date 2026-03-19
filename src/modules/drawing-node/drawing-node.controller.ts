import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { drawingNodeService } from './drawing-node.service.js'
import {
  createDrawingNodeSchema,
  updateDrawingNodeSchema,
  moveDrawingNodeSchema,
} from '../../schemas/drawing-node.js'

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

function getId(req: Request): string {
  const id = req.params.id
  if (typeof id === 'string') return id
  if (Array.isArray(id) && id[0]) return id[0]
  throw new AppError(400, 'BAD_REQUEST', '缺少節點 ID')
}

export const drawingNodeController = {
  async list(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const user = req.user as AuthUser
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const tree = await drawingNodeService.list(projectId, user)
    res.status(200).json({ data: tree })
  },

  async create(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const user = req.user as AuthUser
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const parsed = createDrawingNodeSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const tree = await drawingNodeService.create(projectId, parsed.data, user)
    res.status(201).json({ data: tree })
  },

  async update(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const id = getId(req)
    const user = req.user as AuthUser
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const parsed = updateDrawingNodeSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const tree = await drawingNodeService.update(projectId, id, parsed.data, user)
    res.status(200).json({ data: tree })
  },

  async delete(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const id = getId(req)
    const user = req.user as AuthUser
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    await drawingNodeService.delete(projectId, id, user)
    res.status(204).send()
  },

  async move(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const id = getId(req)
    const user = req.user as AuthUser
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const parsed = moveDrawingNodeSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const tree = await drawingNodeService.move(projectId, id, parsed.data, user)
    res.status(200).json({ data: tree })
  },

  async listRevisions(req: Request, res: Response) {
    const projectId = getProjectId(req)
    const id = getId(req)
    const user = req.user as AuthUser
    if (!user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const items = await drawingNodeService.listRevisions(projectId, id, user)
    res.status(200).json({ data: items })
  },
}
