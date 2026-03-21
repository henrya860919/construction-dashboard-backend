import { z } from 'zod'

const excelAuditSchema = z.object({
  itemNo: z.string().max(512).optional(),
  description: z.string().min(1).max(8000),
  unit: z.string().max(512).optional(),
  qtyRaw: z.string().max(128).optional(),
  unitPriceRaw: z.string().max(128).optional(),
  remark: z.string().max(8000).optional(),
})

const autoMatchedEntrySchema = z
  .object({
    itemKey: z.number().int().positive(),
    newQuantity: z.string().max(128).optional(),
    newUnitPrice: z.string().max(128).optional(),
    excel: excelAuditSchema,
  })
  .superRefine((val, ctx) => {
    const q = val.newQuantity?.trim()
    const p = val.newUnitPrice?.trim()
    if (!q && !p) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'autoMatched 至少需要變更後數量或新增單價其中之一',
      })
    }
  })

const manuallyPlacedEntrySchema = z.object({
  parentItemKey: z.number().int().positive(),
  itemNo: z.string().min(1).max(512),
  description: z.string().min(1).max(8000),
  unit: z.string().min(1).max(512),
  quantity: z.string().min(1).max(128),
  unitPrice: z.string().min(1).max(128),
  remark: z.string().max(8000).optional(),
  excel: excelAuditSchema,
})

export const pccesExcelApplyBodySchema = z.object({
  fileName: z.string().max(500).optional(),
  /** 產生之新版本的顯示名稱（必填，不預設） */
  versionLabel: z.string().min(1).max(200),
  autoMatched: z.array(autoMatchedEntrySchema).default([]),
  manuallyPlaced: z.array(manuallyPlacedEntrySchema).default([]),
})

export type PccesExcelApplyBody = z.infer<typeof pccesExcelApplyBodySchema>
