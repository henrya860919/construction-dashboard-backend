/**
 * 單租後台 API：專案管理、成員管理、租戶資訊、表單樣板（限定本租戶）
 * 需 authMiddleware + requireAdmin（tenant_admin 或 platform_admin）
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'
import { createUserSchema, updateUserSchema } from '../schemas/user.js'
import { updateCompanySettingsSchema } from '../schemas/company-settings.js'
import { userService } from '../modules/user/index.js'
import { fileRepository } from '../modules/file/file.repository.js'
import { storage } from '../lib/storage.js'
import { formTemplateController } from '../modules/form-template/index.js'
import { selfInspectionTemplateController } from '../modules/self-inspection-template/index.js'
import { uploadSingleFile } from '../middleware/upload.js'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { AppError } from '../shared/errors.js'
import { notDeleted, softDeleteSet } from '../shared/soft-delete.js'
import { projectPermissionController } from '../modules/project-permission/project-permission.controller.js'
import { getTenantModuleEntitlementsReadDto } from '../modules/tenant-module-entitlement/tenant-module-entitlement.service.js'

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
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, ...notDeleted },
      select: {
        id: true,
        name: true,
        slug: true,
        logoStorageKey: true,
        status: true,
        expiresAt: true,
        userLimit: true,
        fileSizeLimitMb: true,
        storageQuotaMb: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!tenant) {
      throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    }
    const [memberCount, projectCount, storageUsageBytes] = await Promise.all([
      prisma.user.count({ where: { tenantId, ...notDeleted } }),
      prisma.project.count({ where: { tenantId, ...notDeleted } }),
      fileRepository.getTenantStorageUsageBytesSimple(tenantId),
    ])
    res.status(200).json({
      data: {
        ...tenant,
        memberCount,
        projectCount,
        storageUsageBytes,
      },
    })
  })
)

/** GET /api/v1/admin/tenant/module-entitlements — 本租戶功能模組開通狀態（唯讀，與平台設定一致）；platform_admin 須 ?tenantId= */
adminRouter.get(
  '/tenant/module-entitlements',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const tenantId = user.tenantId ?? (req.query.tenantId as string | undefined)
    if (!tenantId) {
      throw new AppError(404, 'NOT_FOUND', '無所屬租戶或未指定租戶')
    }
    if (user.systemRole !== 'platform_admin' && user.tenantId !== tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能查看所屬租戶')
    }
    const exists = await prisma.tenant.findFirst({
      where: { id: tenantId, ...notDeleted },
      select: { id: true },
    })
    if (!exists) {
      throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    }
    const data = await getTenantModuleEntitlementsReadDto(tenantId)
    res.status(200).json({ data })
  })
)

const LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2MB
const LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']

/** PATCH /api/v1/admin/company-settings — 更新公司名稱（本租戶） */
adminRouter.patch(
  '/company-settings',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const tenantId = user.tenantId ?? null
    if (!tenantId) throw new AppError(400, 'BAD_REQUEST', '無所屬租戶')
    const parsed = updateCompanySettingsSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? '欄位驗證失敗',
          details: parsed.error.flatten(),
        },
      })
      return
    }
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ...notDeleted } })
    if (!tenant) throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    if (user.systemRole !== 'platform_admin' && user.tenantId !== tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能更新所屬租戶')
    }
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { name: parsed.data.name },
      select: { id: true, name: true, logoStorageKey: true, slug: true, status: true, updatedAt: true },
    })
    res.status(200).json({ data: updated })
  })
)

/** POST /api/v1/admin/company-settings/logo — 上傳公司 Logo（multipart: file） */
adminRouter.post(
  '/company-settings/logo',
  uploadSingleFile,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const tenantId = user.tenantId ?? null
    if (!tenantId) throw new AppError(400, 'BAD_REQUEST', '無所屬租戶')
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (!file?.buffer) {
      throw new AppError(400, 'BAD_REQUEST', '請選擇要上傳的圖片')
    }
    if (file.size > LOGO_MAX_BYTES) {
      throw new AppError(400, 'FILE_TOO_LARGE', `Logo 不得超過 ${LOGO_MAX_BYTES / 1024 / 1024} MB`)
    }
    const mime = (file.mimetype || '').toLowerCase()
    if (!LOGO_ALLOWED_MIMES.includes(mime)) {
      throw new AppError(400, 'VALIDATION_ERROR', '僅支援 PNG、JPG、SVG、WebP 圖片')
    }
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, ...notDeleted },
      select: { id: true, logoStorageKey: true },
    })
    if (!tenant) throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
    if (user.systemRole !== 'platform_admin' && user.tenantId !== tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能更新所屬租戶')
    }
    const ext = mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1] ?? 'png'
    const storageKey = `tenants/${tenantId}/logo_${Date.now()}.${ext}`
    await storage.upload(file.buffer, storageKey, mime)
    if (tenant.logoStorageKey) {
      await storage.delete(tenant.logoStorageKey).catch(() => {})
    }
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { logoStorageKey: storageKey },
    })
    res.status(200).json({ data: { logoStorageKey: storageKey } })
  })
)

/** GET /api/v1/admin/tenant-logo — 取得公司 Logo 圖片（stream，需登入） */
adminRouter.get(
  '/tenant-logo',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const tenantId = user.tenantId ?? null
    if (!tenantId) {
      throw new AppError(404, 'NOT_FOUND', '無所屬租戶')
    }
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, ...notDeleted },
      select: { logoStorageKey: true },
    })
    if (!tenant?.logoStorageKey) {
      throw new AppError(404, 'NOT_FOUND', '尚未設定公司 Logo')
    }
    const { stream, contentType } = await storage.getStream(tenant.logoStorageKey)
    res.setHeader('Cache-Control', 'private, max-age=300')
    if (contentType) res.setHeader('Content-Type', contentType)
    stream.pipe(res)
  })
)

/** GET /api/v1/admin/projects — 本租戶專案列表（tenant_admin 僅本租戶；platform_admin 可帶 query tenantId） */
adminRouter.get(
  '/projects',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where: { tenantId?: string } & typeof notDeleted = { ...notDeleted }
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
  })
)

/** DELETE /api/v1/admin/projects/:id — 刪除專案（限本租戶；cascade 關聯資料） */
adminRouter.delete(
  '/projects/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const projectId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!projectId) throw new AppError(400, 'BAD_REQUEST', '缺少專案 id')
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...notDeleted },
      select: { id: true, tenantId: true },
    })
    if (!project) {
      throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    }
    if (user.systemRole !== 'platform_admin' && user.tenantId !== project.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能刪除本租戶專案')
    }
    await prisma.project.update({
      where: { id: projectId },
      data: softDeleteSet(user.id),
    })
    res.status(200).json({ data: { id: projectId } })
  })
)

/** GET /api/v1/admin/users — 本租戶使用者列表（可篩選 memberType：internal | external） */
adminRouter.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const tenantId = (req.query.tenantId as string) || user.tenantId
    const memberType = req.query.memberType as string | undefined
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit

    const where: { tenantId?: string; memberType?: string } & typeof notDeleted = { ...notDeleted }
    if (user.systemRole === 'platform_admin') {
      if (tenantId) where.tenantId = tenantId
    } else {
      where.tenantId = user.tenantId ?? undefined
    }
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
          status: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ])

    res.status(200).json({ data: list, meta: { page, limit, total } })
  })
)

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

/** GET /api/v1/admin/users/:id/permission-template — 成員權限範本（矩陣）；platform_admin 須 ?tenantId= */
adminRouter.get(
  '/users/:id/permission-template',
  asyncHandler(projectPermissionController.getTenantTemplate.bind(projectPermissionController))
)
/** PUT /api/v1/admin/users/:id/permission-template — 整批取代範本（body.modules 須含全部模組） */
adminRouter.put(
  '/users/:id/permission-template',
  asyncHandler(projectPermissionController.replaceTenantTemplate.bind(projectPermissionController))
)
/** POST /api/v1/admin/users/:id/permission-template/apply-preset — 套用預設角色 */
adminRouter.post(
  '/users/:id/permission-template/apply-preset',
  asyncHandler(projectPermissionController.applyTenantPreset.bind(projectPermissionController))
)

/** GET /api/v1/admin/users/:id — 取得單一成員詳情（檢視成員資料） */
adminRouter.get(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const targetId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!targetId) throw new AppError(400, 'BAD_REQUEST', '缺少使用者 id')
    const target = await prisma.user.findFirst({
      where: { id: targetId, ...notDeleted },
      select: {
        id: true,
        email: true,
        name: true,
        systemRole: true,
        memberType: true,
        status: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!target) {
      throw new AppError(404, 'NOT_FOUND', '找不到該使用者')
    }
    if (user.systemRole !== 'platform_admin' && user.tenantId !== target.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能檢視本租戶成員')
    }
    res.status(200).json({ data: target })
  })
)

/** PATCH /api/v1/admin/users/:id — 更新成員（含停用/啟用 status） */
adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const targetId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!targetId) throw new AppError(400, 'BAD_REQUEST', '缺少使用者 id')
    const parsed = updateUserSchema.safeParse(req.body)
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
    const target = await prisma.user.findFirst({
      where: { id: targetId, ...notDeleted },
      select: { id: true, tenantId: true },
    })
    if (!target) {
      throw new AppError(404, 'NOT_FOUND', '找不到該使用者')
    }
    if (user.systemRole !== 'platform_admin' && user.tenantId !== target.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能更新本租戶成員')
    }
    const updateData: Parameters<typeof prisma.user.update>[0]['data'] = {}
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name
    if (parsed.data.systemRole !== undefined) updateData.systemRole = parsed.data.systemRole as 'platform_admin' | 'tenant_admin' | 'project_user'
    if (parsed.data.memberType !== undefined) updateData.memberType = parsed.data.memberType
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status
    if (Object.keys(updateData).length === 0) {
      res.status(200).json({
        data: await prisma.user.findFirst({
          where: { id: targetId, ...notDeleted },
          select: {
            id: true,
            email: true,
            name: true,
            systemRole: true,
            memberType: true,
            status: true,
            tenantId: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      })
      return
    }
    const updated = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        systemRole: true,
        memberType: true,
        status: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    res.status(200).json({ data: updated })
  })
)

/** DELETE /api/v1/admin/users/:id — 刪除本租戶成員（不可刪除自己） */
adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!
    const targetId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!targetId) throw new AppError(400, 'BAD_REQUEST', '缺少使用者 id')
    if (targetId === user.id) {
      throw new AppError(400, 'BAD_REQUEST', '無法刪除自己的帳號')
    }
    const target = await prisma.user.findFirst({
      where: { id: targetId, ...notDeleted },
      select: { id: true, tenantId: true },
    })
    if (!target) {
      throw new AppError(404, 'NOT_FOUND', '找不到該使用者')
    }
    if (user.systemRole !== 'platform_admin' && user.tenantId !== target.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '僅能刪除本租戶成員')
    }
    await prisma.user.update({
      where: { id: targetId },
      data: softDeleteSet(user.id),
    })
    res.status(200).json({ data: { id: targetId } })
  })
)

/** GET /api/v1/admin/form-templates — 後台預設表單樣板列表（本租戶） */
adminRouter.get('/form-templates', asyncHandler(formTemplateController.listDefault.bind(formTemplateController)))

/** POST /api/v1/admin/form-templates — 後台新增預設樣板（multipart: file, name, description） */
adminRouter.post('/form-templates', uploadSingleFile, asyncHandler(formTemplateController.createDefault.bind(formTemplateController)))

/** GET /api/v1/admin/self-inspection-templates — 自主檢查樣板列表（本租戶）；query: tenantId（platform_admin）、status */
adminRouter.get(
  '/self-inspection-templates',
  asyncHandler(selfInspectionTemplateController.list.bind(selfInspectionTemplateController))
)
/** POST /api/v1/admin/self-inspection-templates — 新增樣板；body 可含 tenantId（platform_admin） */
adminRouter.post(
  '/self-inspection-templates',
  asyncHandler(selfInspectionTemplateController.create.bind(selfInspectionTemplateController))
)
/** POST /api/v1/admin/self-inspection-templates/:id/blocks — 新增區塊 */
adminRouter.post(
  '/self-inspection-templates/:id/blocks',
  asyncHandler(selfInspectionTemplateController.createBlock.bind(selfInspectionTemplateController))
)
/** PATCH /api/v1/admin/self-inspection-templates/:id/blocks/:blockId */
adminRouter.patch(
  '/self-inspection-templates/:id/blocks/:blockId',
  asyncHandler(selfInspectionTemplateController.updateBlock.bind(selfInspectionTemplateController))
)
/** DELETE /api/v1/admin/self-inspection-templates/:id/blocks/:blockId */
adminRouter.delete(
  '/self-inspection-templates/:id/blocks/:blockId',
  asyncHandler(selfInspectionTemplateController.deleteBlock.bind(selfInspectionTemplateController))
)
/** POST /api/v1/admin/self-inspection-templates/:id/blocks/:blockId/items — 區塊內新增查驗列 */
adminRouter.post(
  '/self-inspection-templates/:id/blocks/:blockId/items',
  asyncHandler(selfInspectionTemplateController.createBlockItem.bind(selfInspectionTemplateController))
)
/** PATCH /api/v1/admin/self-inspection-templates/:id/blocks/:blockId/items/:itemId */
adminRouter.patch(
  '/self-inspection-templates/:id/blocks/:blockId/items/:itemId',
  asyncHandler(selfInspectionTemplateController.updateBlockItem.bind(selfInspectionTemplateController))
)
/** DELETE /api/v1/admin/self-inspection-templates/:id/blocks/:blockId/items/:itemId */
adminRouter.delete(
  '/self-inspection-templates/:id/blocks/:blockId/items/:itemId',
  asyncHandler(selfInspectionTemplateController.deleteBlockItem.bind(selfInspectionTemplateController))
)
/** GET /api/v1/admin/self-inspection-templates/:id — 樣板＋區塊 */
adminRouter.get(
  '/self-inspection-templates/:id',
  asyncHandler(selfInspectionTemplateController.getById.bind(selfInspectionTemplateController))
)
/** PATCH /api/v1/admin/self-inspection-templates/:id */
adminRouter.patch(
  '/self-inspection-templates/:id',
  asyncHandler(selfInspectionTemplateController.update.bind(selfInspectionTemplateController))
)
/** DELETE /api/v1/admin/self-inspection-templates/:id */
adminRouter.delete(
  '/self-inspection-templates/:id',
  asyncHandler(selfInspectionTemplateController.delete.bind(selfInspectionTemplateController))
)
