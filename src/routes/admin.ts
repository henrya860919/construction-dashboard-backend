/**
 * 單租後台 API：專案管理、成員管理、租戶資訊（限定本租戶）
 * 需 authMiddleware + requireAdmin（tenant_admin 或 platform_admin）
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'
import { createUserSchema } from '../schemas/user.js'
import { userService } from '../modules/user/index.js'
import { fileRepository } from '../modules/file/file.repository.js'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { AppError } from '../shared/errors.js'

export const adminRouter = Router()

/** GET /api/v1/admin/tenant-info — 本租戶資訊（唯讀）：租戶欄位 + 成員數、專案數、總儲存用量 */
adminRouter.get(
  '/tenant-info',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const tenantId = user.tenantId ?? (req.query.tenantId as string | undefined)
    if (!tenantId) {
      throw new AppError(404, 'NOT_FOUND', '無所屬租戶或未指定租戶')
    }
    if (user.systemRole !== 'platform_admin' && user.tenantId !== tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能查看所屬租戶資訊')
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        expiresAt: true,
        userLimit: true,
        fileSizeLimitMb: true,
        storageQuotaMb: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { users: true, projects: true } },
      },
    })
    if (!tenant) {
      throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    }
    const storageUsageBytes = await fileRepository.getTenantStorageUsageBytesSimple(tenantId)
    const t = tenant as typeof tenant & { _count: { users: number; projects: number } }
    const { _count, ...rest } = t
    res.status(200).json({
      data: {
        ...rest,
        memberCount: _count.users,
        projectCount: _count.projects,
        storageUsageBytes,
      },
    })
  })
)

/** GET /api/v1/admin/projects — 本租戶專案列表（tenant_admin 僅本租戶；platform_admin 可帶 query tenantId） */
adminRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where: { tenantId?: string } = {}
    if (user.systemRole === 'platform_admin') {
      const tenantId = req.query.tenantId as string | undefined
      if (tenantId) where.tenantId = tenantId
    } else {
      if (user.tenantId == null || user.tenantId === '') {
        res.status(200).json({ data: [], meta: { page, limit, total: 0 } })
        return
      }
      where.tenantId = user.tenantId
    }

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

/** GET /api/v1/admin/users — 本租戶使用者列表（可篩選 memberType：internal | external） */
adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const tenantId = (req.query.tenantId as string) || user.tenantId
    const memberType = req.query.memberType as string | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where: { tenantId?: string; memberType?: string } =
      user.systemRole === 'platform_admin'
        ? (tenantId ? { tenantId } : {})
        : { tenantId: user.tenantId ?? undefined }
    if (memberType === 'internal' || memberType === 'external') {
      where.memberType = memberType
    }

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
          memberType: true,
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

/** POST /api/v1/admin/users — 租戶新增成員（本租戶使用者；tenant_admin 僅能建 project_user / tenant_admin） */
adminRouter.post(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
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
    const { email, password, name, systemRole: bodyRole, memberType: bodyMemberType, tenantId: bodyTenantId } = parsed.data
    let tenantId: string | null
    let systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
    if (user.systemRole === 'platform_admin') {
      tenantId = bodyTenantId ?? null
      systemRole = (bodyRole ?? 'project_user') as 'platform_admin' | 'tenant_admin' | 'project_user'
    } else {
      if (!user.tenantId) {
        throw new AppError(400, 'BAD_REQUEST', '所屬租戶不明')
      }
      tenantId = user.tenantId
      const role = bodyRole ?? 'project_user'
      if (role === 'platform_admin') {
        throw new AppError(403, 'FORBIDDEN', '租戶管理員無法建立平台管理員')
      }
      systemRole = role as 'tenant_admin' | 'project_user'
    }
    const created = await userService.create({
      email,
      password,
      name,
      systemRole,
      memberType: bodyMemberType ?? 'internal',
      tenantId,
    })
    res.status(201).json({ data: created })
  })
)
