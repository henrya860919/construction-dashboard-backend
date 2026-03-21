import { z } from 'zod'

/** PATCH .../pcces-imports/:importId — 僅更新版本顯示名稱 */
export const pccesImportPatchBodySchema = z.object({
  versionLabel: z.string().max(200),
})

export type PccesImportPatchBody = z.infer<typeof pccesImportPatchBodySchema>
