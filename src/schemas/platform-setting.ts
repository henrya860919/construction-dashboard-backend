import { z } from 'zod'

export const updatePlatformSettingsSchema = z.object({
  maintenanceMode: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  defaultUserLimit: z.number().int().min(0).optional().nullable(),
  defaultStorageQuotaMb: z.number().int().min(0).optional().nullable(),
  defaultFileSizeLimitMb: z.number().int().min(0).optional().nullable(),
})

export type UpdatePlatformSettingsBody = z.infer<typeof updatePlatformSettingsSchema>
