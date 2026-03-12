import { z } from 'zod'

export const createProjectSchema = z.object({
  name: z.string().min(1, '專案名稱為必填'),
  description: z.string().optional(),
  code: z.string().optional(),
  status: z.enum(['active', 'archived']).optional().default('active'),
  tenantId: z.string().cuid().optional().nullable(),
})

export type CreateProjectBody = z.infer<typeof createProjectSchema>

export const updateProjectSchema = createProjectSchema.partial()
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>
