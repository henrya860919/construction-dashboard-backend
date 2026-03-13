/**
 * 公告 API：登入後可取得「當前有效」的公告（依租戶過濾）、標記已讀
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'
import { authMiddleware } from '../middleware/auth.js'

export const announcementsRouter = Router({ mergeParams: true })

announcementsRouter.use(authMiddleware)

/** GET /api/v1/announcements/active — 當前使用者可見的未過期公告，含該使用者的已讀時間 readAt */
announcementsRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id
    const tenantId = req.user?.tenantId ?? null
    const now = new Date()
    const baseWhere = {
      where: {
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { publishedAt: 'desc' as const },
    }
    const rows = userId
      ? await prisma.platformAnnouncement.findMany({
          ...baseWhere,
          include: {
            reads: { where: { userId }, take: 1, select: { readAt: true } },
          },
        })
      : await prisma.platformAnnouncement.findMany(baseWhere)
    const list = rows
      .filter((r) => {
        const ids = r.targetTenantIds as string[] | null
        if (ids == null || ids.length === 0) return true
        return tenantId != null && ids.includes(tenantId)
      })
      .map((r) => {
        const row = r as typeof r & { reads?: { readAt: Date }[] }
        const readAt = userId && row.reads && row.reads.length > 0 ? row.reads[0].readAt : null
        return {
          id: r.id,
          title: r.title,
          body: r.body,
          publishedAt: r.publishedAt?.toISOString() ?? null,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          readAt: readAt != null ? readAt.toISOString() : null,
        }
      })
    res.status(200).json({ data: list })
  } catch (e) {
    console.error('GET /announcements/active', e)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '無法取得公告' } })
  }
})

/** POST /api/v1/announcements/:id/read — 標記該則公告為已讀（關閉後呼叫，不再主動跳出） */
announcementsRouter.post('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '請先登入' } })
      return
    }
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
    if (!id) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少公告 id' } })
      return
    }
    const announcement = await prisma.platformAnnouncement.findUnique({ where: { id } })
    if (!announcement) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '找不到該公告' } })
      return
    }
    await prisma.announcementRead.upsert({
      where: {
        userId_announcementId: { userId, announcementId: id },
      },
      create: { userId, announcementId: id },
      update: {},
    })
    res.status(204).send()
  } catch (e) {
    console.error('POST /announcements/:id/read', e)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '無法標記已讀' } })
  }
})
