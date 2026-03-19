import { z } from 'zod'

const priorityEnum = z.enum(['low', 'medium', 'high'])
const statusEnum = z.enum(['in_progress', 'completed'])

export const createDefectImprovementSchema = z.object({
  description: z.string().min(1, '問題說明為必填').max(2000),
  discoveredBy: z.string().min(1, '發現人為必填').max(200),
  priority: priorityEnum.default('medium'),
  floor: z.string().max(100).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  status: statusEnum.default('in_progress'),
  /** 已上傳的附件 ID（須為同專案、category=defect 且尚未綁定 businessId 的附件） */
  attachmentIds: z.array(z.string().cuid()).optional().default([]),
})

export type CreateDefectImprovementBody = z.infer<typeof createDefectImprovementSchema>

export const updateDefectImprovementSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  discoveredBy: z.string().min(1).max(200).optional(),
  priority: priorityEnum.optional(),
  floor: z.string().max(100).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  status: statusEnum.optional(),
})

export type UpdateDefectImprovementBody = z.infer<typeof updateDefectImprovementSchema>

export const createDefectExecutionRecordSchema = z.object({
  content: z.string().min(1, '執行紀錄內容為必填').max(5000),
  /** 已上傳的附件 ID（同專案，建立後綁定 businessId=recordId, category=defect_record） */
  attachmentIds: z.array(z.string().cuid()).optional().default([]),
})

export type CreateDefectExecutionRecordBody = z.infer<typeof createDefectExecutionRecordSchema>
