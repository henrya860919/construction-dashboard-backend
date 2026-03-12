/**
 * 多租後台 API：租戶、專案總覽、使用者總覽（僅 platform_admin）
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'

export const platformAdminRouter = Router()

/** GET /api/v1/platform-admin/tenants — 租戶列表 */
platformAdminRouter.get('/tenants', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const [list, total] = await Promise.all([
      prisma.tenant.findMany({
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.tenant.count(),
    ])

    res.status(200).json({ data: list, meta: { page, limit, total } })
  } catch (e) {
    console.error('GET /platform-admin/tenants', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得租戶列表' },
    })
  }
})

/** GET /api/v1/platform-admin/projects — 全部專案（可依 tenantId 篩選） */
platformAdminRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where = tenantId ? { tenantId } : {}

    const [list, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          code: true,
          status: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.project.count({ where }),
    ])

    res.status(200).json({ data: list, meta: { page, limit, total } })
  } catch (e) {
    console.error('GET /platform-admin/projects', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得專案列表' },
    })
  }
})

/** GET /api/v1/platform-admin/users — 全部使用者（可依 tenantId 篩選） */
platformAdminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where = tenantId ? { tenantId } : {}

    const [list, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          systemRole: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ])

    res.status(200).json({ data: list, meta: { page, limit, total } })
  } catch (e) {
    console.error('GET /platform-admin/users', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得使用者列表' },
    })
  }
})
