/**
 * 多租後台 API：租戶、專案總覽、使用者總覽、監控、用量（僅 platform_admin）
 */
import type { Prisma } from '@prisma/client'
import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcrypt'
import { prisma } from '../lib/db.js'
import { createTenantSchema, updateTenantSchema } from '../schemas/tenant.js'
import { resetPasswordSchema } from '../schemas/user.js'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { AppError } from '../shared/errors.js'
import { platformAdminMonitoringRouter } from './platform-admin-monitoring.js'
import { platformAdminAnnouncementsRouter } from './platform-admin-announcements.js'
import { recordAudit } from '../modules/audit-log/audit-log.service.js'
import { fileRepository } from '../modules/file/file.repository.js'
import { updatePlatformSettingsSchema } from '../schemas/platform-setting.js'
import { storage } from '../lib/storage/index.js'
import { clearMaintenanceCache } from '../middleware/maintenance.js'

export const platformAdminRouter = Router()

platformAdminRouter.use('/monitoring', platformAdminMonitoringRouter)
platformAdminRouter.use('/announcements', platformAdminAnnouncementsRouter)

function parseExpiresAt(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** GET /api/v1/platform-admin/tenants — 租戶列表 */
platformAdminRouter.get('/tenants', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit
    const statusFilter = req.query.status as string | undefined

    const where = statusFilter === 'active' || statusFilter === 'suspended' ? { status: statusFilter } : {}

    const [list, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { users: true, projects: true } } },
      }),
      prisma.tenant.count({ where }),
    ])

    res.status(200).json({ data: list, meta: { page, limit, total } })
  } catch (e) {
    console.error('GET /platform-admin/tenants', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得租戶列表' },
    })
  }
})

/** GET /api/v1/platform-admin/tenants/:id — 單一租戶 */
platformAdminRouter.get(
  '/tenants/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      throw new AppError(400, 'BAD_REQUEST', '缺少租戶 id')
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { users: true, projects: true } } },
    })
    if (!tenant) {
      throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    }
    res.status(200).json({ data: tenant })
  })
)

/** POST /api/v1/platform-admin/tenants — 新增租戶（僅 platform_admin） */
platformAdminRouter.post(
  '/tenants',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createTenantSchema.safeParse(req.body)
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
    const { name, slug, status, expiresAt, userLimit, fileSizeLimitMb, storageQuotaMb } = parsed.data
    if (slug) {
      const existing = await prisma.tenant.findUnique({ where: { slug } })
      if (existing) {
        throw new AppError(409, 'CONFLICT', '此 slug 已被使用')
      }
    }
    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug: slug || undefined,
        status: status ?? 'active',
        expiresAt: parseExpiresAt(expiresAt ?? null),
        userLimit: userLimit ?? undefined,
        fileSizeLimitMb: fileSizeLimitMb ?? undefined,
        storageQuotaMb: storageQuotaMb ?? undefined,
      },
    })
    await recordAudit(req, { action: 'tenant.create', resourceType: 'tenant', resourceId: tenant.id, tenantId: tenant.id })
    res.status(201).json({ data: tenant })
  })
)

/** PATCH /api/v1/platform-admin/tenants/:id — 更新租戶（編輯、停用、到期日、限制） */
platformAdminRouter.patch(
  '/tenants/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      throw new AppError(400, 'BAD_REQUEST', '缺少租戶 id')
    }
    const parsed = updateTenantSchema.safeParse(req.body)
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
    const existing = await prisma.tenant.findUnique({ where: { id } })
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    }
    const { name, slug, status, expiresAt, userLimit, fileSizeLimitMb, storageQuotaMb } = parsed.data
    if (slug !== undefined && slug !== existing.slug) {
      const duplicate = await prisma.tenant.findUnique({ where: { slug: slug || undefined } })
      if (duplicate) {
        throw new AppError(409, 'CONFLICT', '此 slug 已被使用')
      }
    }
    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug: slug || null }),
        ...(status !== undefined && { status }),
        ...(expiresAt !== undefined && { expiresAt: parseExpiresAt(expiresAt) }),
        ...(userLimit !== undefined && { userLimit }),
        ...(fileSizeLimitMb !== undefined && { fileSizeLimitMb }),
        ...(storageQuotaMb !== undefined && { storageQuotaMb }),
      },
    })
    await recordAudit(req, { action: 'tenant.update', resourceType: 'tenant', resourceId: tenant.id, tenantId: tenant.id })
    res.status(200).json({ data: tenant })
  })
)

/** GET /api/v1/platform-admin/projects — 全部專案（可依 tenantId 篩選，含所屬租戶名稱） */
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
          tenant: { select: { name: true } },
        },
      }),
      prisma.project.count({ where }),
    ])

    const data = list.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      code: p.code,
      status: p.status,
      tenantId: p.tenantId,
      tenantName: p.tenant?.name ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))

    res.status(200).json({ data, meta: { page, limit, total } })
  } catch (e) {
    console.error('GET /platform-admin/projects', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得專案列表' },
    })
  }
})

/** GET /api/v1/platform-admin/users — 全部使用者（可依 tenantId / systemRole / memberType 篩選） */
platformAdminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenantId as string | undefined
    const systemRole = req.query.systemRole as string | undefined
    const memberType = req.query.memberType as string | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where: Prisma.UserWhereInput = {}
    if (tenantId) where.tenantId = tenantId
    if (systemRole === 'platform_admin' || systemRole === 'tenant_admin' || systemRole === 'project_user') where.systemRole = systemRole
    if (memberType === 'internal' || memberType === 'external') where.memberType = memberType

    const [rows, total] = await Promise.all([
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
          tenant: { select: { name: true } },
        },
      }),
      prisma.user.count({ where }),
    ])

    const list = rows.map((u) => {
      const row = u as typeof u & { tenant?: { name: string } | null }
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        systemRole: row.systemRole,
        memberType: row.memberType,
        tenantId: row.tenantId,
        tenantName: row.tenant?.name ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })

    res.status(200).json({ data: list, meta: { page, limit, total } })
  } catch (e) {
    console.error('GET /platform-admin/users', e)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '無法取得使用者列表' },
    })
  }
})

/** PATCH /api/v1/platform-admin/users/:id/password — 平台管理員重設使用者密碼 */
platformAdminRouter.patch(
  '/users/:id/password',
  asyncHandler(async (req: Request, res: Response) => {
    const rawId = req.params.id
    const userId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : undefined
    if (!userId) throw new AppError(400, 'BAD_REQUEST', '缺少使用者 ID')
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? '欄位驗證失敗'
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new AppError(404, 'NOT_FOUND', '找不到該使用者')
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10)
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    })
    await recordAudit(req, { action: 'user.password_reset', resourceType: 'user', resourceId: userId, tenantId: user.tenantId })
    res.status(200).json({ data: { ok: true } })
  })
)

/** GET /api/v1/platform-admin/usage — 各租戶用量總覽 */
platformAdminRouter.get(
  '/usage',
  asyncHandler(async (_req: Request, res: Response) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true, projects: true } } },
    })
    const usageList = await Promise.all(
      tenants.map(async (t) => {
        const storageBytes = await fileRepository.getTenantStorageUsageBytesSimple(t.id)
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          userCount: t._count.users,
          projectCount: t._count.projects,
          storageUsageBytes: storageBytes,
          userLimit: t.userLimit,
          storageQuotaMb: t.storageQuotaMb,
          expiresAt: t.expiresAt,
        }
      })
    )
    res.status(200).json({ data: usageList })
  })
)

// ---------- 平台設定 ----------
const SETTING_KEYS = {
  MAINTENANCE_MODE: 'maintenance_mode',
  DEFAULT_USER_LIMIT: 'default_user_limit',
  DEFAULT_STORAGE_QUOTA_MB: 'default_storage_quota_mb',
  DEFAULT_FILE_SIZE_LIMIT_MB: 'default_file_size_limit_mb',
} as const

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

/** GET /api/v1/platform-admin/settings */
platformAdminRouter.get(
  '/settings',
  asyncHandler(async (_req: Request, res: Response) => {
    const [maintenanceMode, defaultUserLimit, defaultStorageQuotaMb, defaultFileSizeLimitMb] = await Promise.all([
      getSetting(SETTING_KEYS.MAINTENANCE_MODE),
      getSetting(SETTING_KEYS.DEFAULT_USER_LIMIT),
      getSetting(SETTING_KEYS.DEFAULT_STORAGE_QUOTA_MB),
      getSetting(SETTING_KEYS.DEFAULT_FILE_SIZE_LIMIT_MB),
    ])
    res.status(200).json({
      data: {
        maintenanceMode: maintenanceMode === 'true',
        defaultUserLimit: defaultUserLimit != null ? Number(defaultUserLimit) : null,
        defaultStorageQuotaMb: defaultStorageQuotaMb != null ? Number(defaultStorageQuotaMb) : null,
        defaultFileSizeLimitMb: defaultFileSizeLimitMb != null ? Number(defaultFileSizeLimitMb) : null,
      },
    })
  })
)

/** PATCH /api/v1/platform-admin/settings */
platformAdminRouter.patch(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updatePlatformSettingsSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '欄位驗證失敗', details: parsed.error.flatten() },
      })
      return
    }
    const { maintenanceMode, defaultUserLimit, defaultStorageQuotaMb, defaultFileSizeLimitMb } = parsed.data
    if (maintenanceMode !== undefined) {
      await setSetting(SETTING_KEYS.MAINTENANCE_MODE, maintenanceMode ? 'true' : 'false')
      clearMaintenanceCache()
    }
    if (defaultUserLimit !== undefined) await setSetting(SETTING_KEYS.DEFAULT_USER_LIMIT, String(defaultUserLimit ?? ''))
    if (defaultStorageQuotaMb !== undefined) await setSetting(SETTING_KEYS.DEFAULT_STORAGE_QUOTA_MB, String(defaultStorageQuotaMb ?? ''))
    if (defaultFileSizeLimitMb !== undefined) await setSetting(SETTING_KEYS.DEFAULT_FILE_SIZE_LIMIT_MB, String(defaultFileSizeLimitMb ?? ''))
    const [mm, dul, dsq, dfs] = await Promise.all([
      getSetting(SETTING_KEYS.MAINTENANCE_MODE),
      getSetting(SETTING_KEYS.DEFAULT_USER_LIMIT),
      getSetting(SETTING_KEYS.DEFAULT_STORAGE_QUOTA_MB),
      getSetting(SETTING_KEYS.DEFAULT_FILE_SIZE_LIMIT_MB),
    ])
    res.status(200).json({
      data: {
        maintenanceMode: mm === 'true',
        defaultUserLimit: dul != null && dul !== '' ? Number(dul) : null,
        defaultStorageQuotaMb: dsq != null && dsq !== '' ? Number(dsq) : null,
        defaultFileSizeLimitMb: dfs != null && dfs !== '' ? Number(dfs) : null,
      },
    })
  })
)

/** GET /api/v1/platform-admin/system/status — 系統狀態（DB、儲存） */
platformAdminRouter.get(
  '/system/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const dbMs = Date.now() - dbStart

    let storageStatus = 'ok'
    const storageStart = Date.now()
    try {
      await storage.upload(Buffer.from('health'), '_health_check')
      await storage.delete('_health_check')
    } catch (e) {
      storageStatus = 'error'
      console.error('Storage health check', e)
    }
    const storageMs = Date.now() - storageStart

    res.status(200).json({
      data: {
        database: { status: 'ok', latencyMs: dbMs },
        storage: { status: storageStatus, latencyMs: storageMs },
      },
    })
  })
)
