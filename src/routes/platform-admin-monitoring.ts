/**
 * 平台監控 API：stats、login-logs、audit-logs、usage（僅 platform_admin）
 */
import { Router, type Request, type Response } from 'express'
import { loginLogRepository } from '../modules/login-log/login-log.repository.js'
import { auditLogRepository } from '../modules/audit-log/audit-log.repository.js'
import { asyncHandler } from '../shared/utils/async-handler.js'

export const platformAdminMonitoringRouter = Router()

function parseDate(q: string | undefined): Date | undefined {
  if (!q) return undefined
  const d = new Date(q)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** GET /platform-admin/monitoring/stats */
platformAdminMonitoringRouter.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const [loginStats, activeUsers, auditStats] = await Promise.all([
      loginLogRepository.getStats(),
      loginLogRepository.getActiveUserCounts(),
      auditLogRepository.getStats(),
    ])
    res.status(200).json({
      data: {
        login: loginStats,
        activeUsers,
        audit: auditStats,
      },
    })
  })
)

/** GET /platform-admin/monitoring/login-logs */
platformAdminMonitoringRouter.get(
  '/login-logs',
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit
    const email = typeof req.query.email === 'string' ? req.query.email.trim() || undefined : undefined
    const successStr = req.query.success
    const success =
      successStr === 'true' ? true : successStr === 'false' ? false : undefined
    const from = parseDate(req.query.from as string)
    const to = parseDate(req.query.to as string)

    const [list, total] = await Promise.all([
      loginLogRepository.findMany({ skip, take: limit, email, success, from, to }),
      loginLogRepository.count({ email, success, from, to }),
    ])

    type Row = (typeof list)[number]
    const data = list.map((row: Row) => {
      const u = row as Row & { user?: { id: string; name: string | null; systemRole: string; tenantId: string | null } }
      return {
        id: row.id,
        userId: row.userId,
        email: row.email,
        success: row.success,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        failureReason: row.failureReason,
        createdAt: row.createdAt,
        user: u.user ? { id: u.user.id, name: u.user.name, systemRole: u.user.systemRole, tenantId: u.user.tenantId } : null,
      }
    })
    res.status(200).json({ data, meta: { page, limit, total } })
  })
)

/** GET /platform-admin/monitoring/audit-logs */
platformAdminMonitoringRouter.get(
  '/audit-logs',
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() || undefined : undefined
    const action = typeof req.query.action === 'string' ? req.query.action.trim() || undefined : undefined
    const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType.trim() || undefined : undefined
    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() || undefined : undefined
    const from = parseDate(req.query.from as string)
    const to = parseDate(req.query.to as string)

    const [list, total] = await Promise.all([
      auditLogRepository.findMany({ skip, take: limit, userId, action, resourceType, tenantId, from, to }),
      auditLogRepository.count({ userId, action, resourceType, tenantId, from, to }),
    ])

    type AuditRow = (typeof list)[number]
    const data = list.map((row: AuditRow) => {
      const u = row as AuditRow & { user?: { id: string; email: string; name: string | null } }
      return {
        id: row.id,
        userId: row.userId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        tenantId: row.tenantId,
        details: row.details,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        user: u.user ? { id: u.user.id, email: u.user.email, name: u.user.name } : null,
      }
    })
    res.status(200).json({ data, meta: { page, limit, total } })
  })
)

