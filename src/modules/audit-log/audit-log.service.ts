import type { Request } from 'express'
import type { Prisma } from '@prisma/client'
import { auditLogRepository } from './audit-log.repository.js'

function getIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? null
  return req.ip ?? null
}

function getUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}

export type AuditRecordParams = {
  action: string
  resourceType: string
  resourceId?: string | null
  tenantId?: string | null
  details?: Prisma.InputJsonValue
}

/**
 * 寫入一筆稽核日誌（可由各 route 在操作成功後呼叫）。
 * 不阻塞回應，寫入失敗僅 log，不拋出。
 */
export async function recordAudit(req: Request, params: AuditRecordParams): Promise<void> {
  const userId = req.user?.id ?? null
  try {
    await auditLogRepository.create({
      userId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      tenantId: params.tenantId ?? null,
      details: params.details ?? null,
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    })
  } catch (e) {
    console.error('auditLog.record', params.action, e)
  }
}
