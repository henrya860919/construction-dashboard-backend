import { z } from 'zod'

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, '標題為必填'),
  body: z.string(),
  publishedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  targetTenantIds: z.array(z.string()).optional().nullable(), // null 或 [] = 全平台
})

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  publishedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  targetTenantIds: z.array(z.string()).optional().nullable(),
})

export type CreateAnnouncementBody = z.infer<typeof createAnnouncementSchema>
export type UpdateAnnouncementBody = z.infer<typeof updateAnnouncementSchema>
