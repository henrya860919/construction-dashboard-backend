import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('請輸入有效 Email'),
  password: z.string().min(1, '請輸入密碼'),
})

export type LoginBody = z.infer<typeof loginSchema>
