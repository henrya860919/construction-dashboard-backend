import { z } from 'zod'
import { PERMISSION_MODULES } from '../constants/permission-modules.js'

const modulePermSchema = z.object({
  canCreate: z.boolean(),
  canRead: z.boolean(),
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
})

/** 可只送部分模組；未出現者保留或由後端全量取代時忽略 */
export const permissionModulesPartialSchema = z.record(z.string(), modulePermSchema).refine(
  (rec) => Object.keys(rec).every((k) => PERMISSION_MODULES.includes(k as (typeof PERMISSION_MODULES)[number])),
  { message: '含未知的 module id' }
)

export const replacePermissionModulesSchema = z.object({
  modules: z
    .record(z.string(), modulePermSchema)
    .refine(
      (rec) => {
        const keys = Object.keys(rec).sort()
        const expected = [...PERMISSION_MODULES].sort()
        if (keys.length !== expected.length) return false
        return keys.every((k, i) => k === expected[i] && PERMISSION_MODULES.includes(k as (typeof PERMISSION_MODULES)[number]))
      },
      { message: 'modules 須包含且僅包含所有已定義之功能模組 id' }
    ),
})

export const applyPermissionPresetSchema = z.object({
  presetKey: z.enum(['site_supervisor', 'equipment_manager', 'owner_viewer', 'project_engineer']),
})
