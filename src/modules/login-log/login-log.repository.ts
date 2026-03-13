import { prisma } from '../../lib/db.js'

const select = {
  id: true,
  userId: true,
  email: true,
  success: true,
  ipAddress: true,
  userAgent: true,
  failureReason: true,
  createdAt: true,
} as const

export type LoginLogItem = {
  id: string
  userId: string | null
  email: string
  success: boolean
  ipAddress: string | null
  userAgent: string | null
  failureReason: string | null
  createdAt: Date
}

export const loginLogRepository = {
  create(data: {
    userId: string | null
    email: string
    success: boolean
    ipAddress: string | null
    userAgent: string | null
    failureReason: string | null
  }) {
    return prisma.loginLog.create({
      data: {
        userId: data.userId,
        email: data.email,
        success: data.success,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        failureReason: data.failureReason,
      },
      select,
    }) as Promise<LoginLogItem>
  },

  findMany(args: {
    skip: number
    take: number
    email?: string
    success?: boolean
    from?: Date
    to?: Date
  }) {
    const where: { email?: string; success?: boolean; createdAt?: { gte?: Date; lte?: Date } } = {}
    if (args.email) where.email = args.email
    if (args.success !== undefined) where.success = args.success
    if (args.from ?? args.to) {
      where.createdAt = {}
      if (args.from) where.createdAt.gte = args.from
      if (args.to) where.createdAt.lte = args.to
    }
    return prisma.loginLog.findMany({
      where,
      skip: args.skip,
      take: args.take,
      orderBy: { createdAt: 'desc' },
      select: {
        ...select,
        user: { select: { id: true, name: true, systemRole: true, tenantId: true } },
      },
    })
  },

  count(args: { email?: string; success?: boolean; from?: Date; to?: Date }) {
    const where: { email?: string; success?: boolean; createdAt?: { gte?: Date; lte?: Date } } = {}
    if (args.email) where.email = args.email
    if (args.success !== undefined) where.success = args.success
    if (args.from ?? args.to) {
      where.createdAt = {}
      if (args.from) where.createdAt.gte = args.from
      if (args.to) where.createdAt.lte = args.to
    }
    return prisma.loginLog.count({ where })
  },

  /** 今日成功／失敗／總數；近 7 日總數與失敗數 */
  async getStats() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(todayStart)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const [todayTotal, todaySuccess, todayFailed, last7Total, last7Failed] = await Promise.all([
      prisma.loginLog.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.loginLog.count({ where: { createdAt: { gte: todayStart }, success: true } }),
      prisma.loginLog.count({ where: { createdAt: { gte: todayStart }, success: false } }),
      prisma.loginLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.loginLog.count({ where: { createdAt: { gte: sevenDaysAgo }, success: false } }),
    ])

    return { todayTotal, todaySuccess, todayFailed, last7Total, last7Failed }
  },

  /** 過去 24h / 7d 內有成功登入的不重複 userId 數 */
  async getActiveUserCounts() {
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [last24h, last7d] = await Promise.all([
      prisma.loginLog.findMany({
        where: { createdAt: { gte: oneDayAgo }, success: true, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.loginLog.findMany({
        where: { createdAt: { gte: sevenDaysAgo }, success: true, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ])
    return { last24h: last24h.length, last7d: last7d.length }
  },
}
