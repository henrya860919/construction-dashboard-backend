import type { Request, Response } from 'express'
import type { Prisma } from '@prisma/client'
import { createProjectSchema, updateProjectSchema } from '../../schemas/project.js'
import { parsePageLimit } from '../../shared/utils/pagination.js'
import { recordAudit } from '../audit-log/audit-log.service.js'
import { projectService } from './project.service.js'

export const projectController = {
  async list(req: Request, res: Response) {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '請先登入' } })
      return
    }
    const { page, limit, skip } = parsePageLimit(req)
    const { list, total } = await projectService.list({ page, limit, skip }, user)
    res.status(200).json({
      data: list,
      meta: { page, limit, total },
    })
  },

  async getById(req: Request, res: Response) {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '請先登入' } })
      return
    }
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少專案 id' } })
      return
    }
    const project = await projectService.getById(id, user)
    res.status(200).json({ data: project })
  },

  async create(req: Request, res: Response) {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '請先登入' } })
      return
    }
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
    const project = await projectService.create(parsed.data, user)
    await recordAudit(req, {
      action: 'project.create',
      resourceType: 'project',
      resourceId: project.id,
      tenantId: project.tenantId,
    })
    res.status(201).json({ data: project })
  },

  async update(req: Request, res: Response) {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '請先登入' } })
      return
    }
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少專案 id' } })
      return
    }
    const parsed = updateProjectSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '欄位驗證失敗', details: parsed.error.flatten() },
      })
      return
    }
    const beforeProject = await projectService.getById(id, user)
    const project = await projectService.update(id, parsed.data, user)
    const auditFields = [
      'name', 'description', 'code', 'status', 'designUnit', 'supervisionUnit',
      'contractor', 'summary', 'benefits', 'siteManager', 'contactPhone', 'projectStaff',
      'startDate', 'plannedEndDate', 'revisedEndDate',
    ] as const
    const toSnapshot = (p: typeof project) => {
      const out: Record<string, unknown> = {}
      for (const key of auditFields) {
        const v = p[key]
        out[key] = v instanceof Date ? v.toISOString() : v
      }
      return out
    }
    await recordAudit(req, {
      action: 'project.update',
      resourceType: 'project',
      resourceId: project.id,
      tenantId: project.tenantId,
      details: { before: toSnapshot(beforeProject), after: toSnapshot(project) } as Prisma.InputJsonValue,
    })
    res.status(200).json({ data: project })
  },
}
