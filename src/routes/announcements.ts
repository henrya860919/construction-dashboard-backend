/**
 * 公告 API：登入後可取得「當前有效」的公告（依租戶過濾）
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'
import { authMiddleware } from '../middleware/auth.js'

export const announcementsRouter = Router({ mergeParams: true })

announcementsRouter.use(authMiddleware)

/** GET /api/v1/announcements/active — 當前使用者可見的未過期公告 */
announcementsRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const now = new Date()
    const tenantId = req.user?.tenantId ?? null
    const rows = await prisma.platformAnnouncement.findMany({
      where: {
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { publishedAt: 'desc' },
    })
    const list = rows.filter((r) => {
      const ids = r.targetTenantIds as string[] | null
      if (ids == null || ids.length === 0) return true
      return tenantId != null && ids.includes(tenantId)
    })
    res.status(200).json({ data: list })
  } catch (e) {
    console.error('GET /announcements/active', e)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '無法取得公告' } })
  }
})
