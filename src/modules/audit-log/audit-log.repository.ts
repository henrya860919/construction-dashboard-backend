import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

const select = {
  id: true,
  userId: true,
  action: true,
  resourceType: true,
  resourceId: true,
  tenantId: true,
  details: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const

export type AuditLogItem = {
  id: string
  userId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  tenantId: string | null
  details: Prisma.JsonValue
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}

export const auditLogRepository = {
  create(data: {
    userId: string | null
    action: string
    resourceType: string
    resourceId: string | null
    tenantId: string | null
    details?: Prisma.InputJsonValue | null
    ipAddress: string | null
    userAgent: string | null
  }) {
    return prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        tenantId: data.tenantId,
        ...(data.details !== undefined && data.details !== null && { details: data.details }),
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
      select,
    }) as Promise<AuditLogItem>
  },

  findMany(args: {
    skip: number
    take: number
    userId?: string
    action?: string
    resourceType?: string
    resourceId?: string
    tenantId?: string
    from?: Date
    to?: Date
  }) {
    const where: Prisma.AuditLogWhereInput = {}
    if (args.userId) where.userId = args.userId
    if (args.action) where.action = args.action
    if (args.resourceType) where.resourceType = args.resourceType
    if (args.resourceId) where.resourceId = args.resourceId
    if (args.tenantId) where.tenantId = args.tenantId
    if (args.from ?? args.to) {
      where.createdAt = {}
      if (args.from) where.createdAt.gte = args.from
      if (args.to) where.createdAt.lte = args.to
    }
    return prisma.auditLog.findMany({
      where,
      skip: args.skip,
      take: args.take,
      orderBy: { createdAt: 'desc' },
      select: {
        ...select,
        user: { select: { id: true, email: true, name: true } },
      },
    })
  },

  count(args: {
    userId?: string
    action?: string
    resourceType?: string
    tenantId?: string
    from?: Date
    to?: Date
  }) {
    const where: Prisma.AuditLogWhereInput = {}
    if (args.userId) where.userId = args.userId
    if (args.action) where.action = args.action
    if (args.resourceType) where.resourceType = args.resourceType
    if (args.tenantId) where.tenantId = args.tenantId
    if (args.from ?? args.to) {
      where.createdAt = {}
      if (args.from) where.createdAt.gte = args.from
      if (args.to) where.createdAt.lte = args.to
    }
    return prisma.auditLog.count({ where })
  },

  async getStats() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(todayStart)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const [todayCount, last7DaysCount] = await Promise.all([
      prisma.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.auditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ])
    return { todayCount, last7DaysCount }
  },
}
