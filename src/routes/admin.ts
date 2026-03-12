/**
 * 單租後台 API：專案管理、成員管理（限定本租戶）
 * 需 authMiddleware + requireAdmin（tenant_admin 或 platform_admin）
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'

export const adminRouter = Router()

/** GET /api/v1/admin/projects — 本租戶專案列表（tenant_admin 僅本租戶；platform_admin 可帶 query tenantId） */
adminRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const tenantId = (req.query.tenantId as string) || user.tenantId
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where = user.systemRole === 'platform_admin'
      ? (tenantId ? { tenantId } : {})
      : { tenantId: user.tenantId ?? undefined }

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
    console.error('GET /admin/projects', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得專案列表' },
    })
  }
})

/** GET /api/v1/admin/users — 本租戶使用者列表（tenant_admin 僅本租戶；platform_admin 可帶 query tenantId） */
adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const tenantId = (req.query.tenantId as string) || user.tenantId
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where = user.systemRole === 'platform_admin'
      ? (tenantId ? { tenantId } : {})
      : { tenantId: user.tenantId ?? undefined }

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
    console.error('GET /admin/users', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得使用者列表' },
    })
  }
})
