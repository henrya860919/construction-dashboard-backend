import { z } from 'zod'

const systemRoleEnum = z.enum(['platform_admin', 'tenant_admin', 'project_user'])

export const createUserSchema = z.object({
  email: z.string().email('請輸入有效 Email'),
  password: z.string().min(6, '密碼至少 6 碼'),
  name: z.string().optional(),
  systemRole: systemRoleEnum.optional().default('project_user'),
  tenantId: z.string().cuid().optional().nullable(),
})

export type CreateUserBody = z.infer<typeof createUserSchema>
