/**
 * 平台公告 API：CRUD（僅 platform_admin）
 */
import { Prisma } from '@prisma/client'
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/db.js'
import { createAnnouncementSchema, updateAnnouncementSchema } from '../schemas/announcement.js'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { AppError } from '../shared/errors.js'

export const platformAdminAnnouncementsRouter = Router()

function parseDate(s: string | null | undefined): Date | null {
  if (s == null || s === '') return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function targetTenantIdsToJson(ids: string[] | null | undefined): Prisma.InputJsonValue | undefined {
  if (ids === undefined) return undefined
  if (ids === null) return Prisma.DbNull as unknown as Prisma.InputJsonValue
  return ids
}

/** GET /platform-admin/announcements — 列表，分頁 */
platformAdminAnnouncementsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const skip = (page - 1) * limit
    const [list, total] = await Promise.all([
      prisma.platformAnnouncement.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.platformAnnouncement.count(),
    ])
    res.status(200).json({ data: list, meta: { page, limit, total } })
  })
)

function paramId(req: Request): string {
  const p = req.params.id
  return Array.isArray(p) ? p[0] ?? '' : p ?? ''
}

/** GET /platform-admin/announcements/:id */
platformAdminAnnouncementsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req)
    const row = await prisma.platformAnnouncement.findUnique({ where: { id } })
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該公告')
    res.status(200).json({ data: row })
  })
)

/** POST /platform-admin/announcements */
platformAdminAnnouncementsRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createAnnouncementSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '欄位驗證失敗', details: parsed.error.flatten() },
      })
      return
    }
    const { title, body, publishedAt, expiresAt, targetTenantIds } = parsed.data
    const row = await prisma.platformAnnouncement.create({
      data: {
        title,
        body: body ?? '',
        publishedAt: parseDate(publishedAt ?? null),
        expiresAt: parseDate(expiresAt ?? null),
        targetTenantIds: targetTenantIdsToJson(targetTenantIds),
      },
    })
    res.status(201).json({ data: row })
  })
)

/** PATCH /platform-admin/announcements/:id */
platformAdminAnnouncementsRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req)
    const existing = await prisma.platformAnnouncement.findUnique({ where: { id } })
    if (!existing) throw new AppError(404, 'NOT_FOUND', '找不到該公告')
    const parsed = updateAnnouncementSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '欄位驗證失敗', details: parsed.error.flatten() },
      })
      return
    }
    const { title, body, publishedAt, expiresAt, targetTenantIds } = parsed.data
    const data: { title?: string; body?: string; publishedAt?: Date | null; expiresAt?: Date | null; targetTenantIds?: Prisma.InputJsonValue } = {}
    if (title !== undefined) data.title = title
    if (body !== undefined) data.body = body
    if (publishedAt !== undefined) data.publishedAt = parseDate(publishedAt)
    if (expiresAt !== undefined) data.expiresAt = parseDate(expiresAt)
    if (targetTenantIds !== undefined) data.targetTenantIds = targetTenantIdsToJson(targetTenantIds)
    const row = await prisma.platformAnnouncement.update({
      where: { id },
      data,
    })
    res.status(200).json({ data: row })
  })
)

/** DELETE /platform-admin/announcements/:id */
platformAdminAnnouncementsRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req)
    await prisma.platformAnnouncement.delete({ where: { id } }).catch(() => {
      throw new AppError(404, 'NOT_FOUND', '找不到該公告')
    })
    res.status(200).json({ data: { ok: true } })
  })
)
