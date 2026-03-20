import { z } from 'zod'
import { PERMISSION_MODULES } from '../constants/permission-modules.js'

const moduleIdSchema = z.enum(PERMISSION_MODULES as unknown as [string, ...string[]])

export const replaceTenantModuleEntitlementsSchema = z.object({
  /** 未傳、null、非陣列時視為 []，避免 body 不完整導致驗證失敗 */
  disabledModuleIds: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(moduleIdSchema)),
})

export type ReplaceTenantModuleEntitlementsInput = z.infer<typeof replaceTenantModuleEntitlementsSchema>
