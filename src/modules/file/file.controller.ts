import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { fileService } from './file.service.js'
import { z } from 'zod'

const uploadBodySchema = z.object({
  projectId: z.string().min(1, 'projectId 必填'),
  category: z.string().optional(),
  businessId: z.string().optional(),
  /** 前端傳入的原始檔名（UTF-8），若提供則優先於 file.originalname，避免編碼問題 */
  fileName: z.string().optional(),
})

export const fileController = {
  async upload(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (!file?.buffer) {
      throw new AppError(400, 'BAD_REQUEST', '請上傳檔案')
    }
    const parsed = uploadBodySchema.safeParse(req.body)
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e) => e.message).join(', ')
      throw new AppError(400, 'VALIDATION_ERROR', msg)
    }
    const { projectId, category, businessId, fileName: bodyFileName } = parsed.data
    const displayFileName = (bodyFileName?.trim() && bodyFileName) || file.originalname || 'file'
    const attachment = await fileService.uploadFile(
      file.buffer,
      displayFileName,
      file.mimetype ?? 'application/octet-stream',
      projectId,
      req.user.id,
      req.user,
      { category, businessId }
    )
    res.status(201).json({
      data: {
        id: attachment.id,
        projectId: attachment.projectId,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        category: attachment.category,
        createdAt: attachment.createdAt.toISOString(),
        url: `/api/v1/files/${attachment.id}`,
      },
    })
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const id = req.params.id as string
    const download = req.query.download === 'true' || req.query.download === '1'
    const result = await fileService.getById(id, req.user.id, req.user)
    const { stream, ...meta } = result
    if (!stream) {
      throw new AppError(500, 'INTERNAL_ERROR', '無法讀取檔案')
    }
    res.setHeader('Content-Type', meta.mimeType)
    if (download) {
      const safeAscii = meta.fileName.replace(/[^\x20-\x7E]/g, '_').trim() || 'download'
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`
      )
    }
    stream.pipe(res)
  },

  async listByProject(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const projectId = req.params.projectId as string
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    const { items, total } = await fileService.listByProject(
      projectId,
      { page, limit, category },
      req.user.id,
      req.user
    )
    res.json({
      data: items.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        fileName: row.fileName,
        fileSize: row.fileSize,
        mimeType: row.mimeType,
        category: row.category,
        uploadedById: row.uploadedById,
        uploaderName: row.uploaderName ?? null,
        createdAt: row.createdAt.toISOString(),
        url: `/api/v1/files/${row.id}`,
      })),
      meta: { page, limit, total },
    })
  },

  async delete(req: Request, res: Response) {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', '請先登入')
    const id = req.params.id as string
    await fileService.delete(id, req.user.id, req.user)
    res.status(204).send()
  },
}
