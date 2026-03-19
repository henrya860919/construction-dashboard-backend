import { z } from 'zod'

const kindSchema = z.enum(['folder', 'leaf'])

export const createDrawingNodeSchema = z.object({
  parentId: z.union([z.string().min(1), z.null()]).optional(),
  name: z.string().min(1, '名稱必填').max(500),
  kind: kindSchema,
})

export const updateDrawingNodeSchema = z.object({
  name: z.string().min(1, '名稱必填').max(500),
})

export const moveDrawingNodeSchema = z.object({
  parentId: z.string().min(1).nullable().optional(),
  insertBeforeId: z.string().min(1).nullable().optional(),
})

export type CreateDrawingNodeBody = z.infer<typeof createDrawingNodeSchema>
export type UpdateDrawingNodeBody = z.infer<typeof updateDrawingNodeSchema>
export type MoveDrawingNodeBody = z.infer<typeof moveDrawingNodeSchema>
