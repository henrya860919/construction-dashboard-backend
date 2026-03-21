import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '請使用 YYYY-MM-DD')

function toDecimalString(v: unknown): string {
  if (v === null || v === undefined) return '0'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  const s = String(v).replace(/,/g, '').trim()
  if (s === '') return '0'
  const n = parseFloat(s)
  return Number.isFinite(n) ? String(n) : '0'
}

const decimalField = z.union([z.string(), z.number()]).transform(toDecimalString)

const preWorkEducationSchema = z.enum(['yes', 'no'])
const newWorkerInsuranceSchema = z.enum(['yes', 'no', 'no_new'])
const ppeCheckSchema = z.enum(['yes', 'no'])

export const constructionDailyLogWorkItemInputSchema = z.object({
  /** 綁定最新「已核定」PCCES general 工項時帶入；手填列請省略 */
  pccesItemId: z.string().min(1).max(128).optional(),
  workItemName: z.string().min(1).max(4000),
  unit: z.string().max(100).default(''),
  contractQty: decimalField,
  /** 綁定 PCCES 時建議帶入單價快照；省略則儲存為 null */
  unitPrice: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      const s = String(v).replace(/,/g, '').trim()
      if (s === '') return undefined
      return toDecimalString(v)
    }),
  dailyQty: decimalField,
  accumulatedQty: decimalField,
  remark: z.string().max(8000).default(''),
})

export const constructionDailyLogMaterialInputSchema = z.object({
  materialName: z.string().min(1).max(4000),
  unit: z.string().max(100).default(''),
  contractQty: decimalField,
  dailyUsedQty: decimalField,
  accumulatedQty: decimalField,
  remark: z.string().max(8000).default(''),
})

export const constructionDailyLogPersonnelEquipmentInputSchema = z.object({
  workType: z.string().max(500).default(''),
  dailyWorkers: z.coerce.number().int().min(0).max(999999).default(0),
  accumulatedWorkers: z.coerce.number().int().min(0).max(999999).default(0),
  equipmentName: z.string().max(500).default(''),
  dailyEquipmentQty: decimalField,
  accumulatedEquipmentQty: decimalField,
})

const baseBody = {
  reportNo: z.string().max(200).optional().nullable(),
  weatherAm: z.string().max(200).optional().nullable(),
  weatherPm: z.string().max(200).optional().nullable(),
  logDate: isoDate,
  projectName: z.string().min(1).max(2000),
  contractorName: z.string().min(1).max(2000),
  approvedDurationDays: z.coerce.number().int().min(0).max(365000).optional().nullable(),
  accumulatedDays: z.coerce.number().int().min(0).max(365000).optional().nullable(),
  remainingDays: z.coerce.number().int().min(-365000).max(365000).optional().nullable(),
  extendedDays: z.coerce.number().int().min(0).max(365000).optional().nullable(),
  startDate: isoDate.optional().nullable(),
  completionDate: isoDate.optional().nullable(),
  actualProgress: z.coerce.number().min(0).max(100).optional().nullable(),
  specialItemA: z.string().max(8000).default(''),
  specialItemB: z.string().max(8000).default(''),
  hasTechnician: z.boolean().default(false),
  preWorkEducation: preWorkEducationSchema.default('no'),
  newWorkerInsurance: newWorkerInsuranceSchema.default('no_new'),
  ppeCheck: ppeCheckSchema.default('no'),
  otherSafetyNotes: z.string().max(8000).default(''),
  sampleTestRecord: z.string().max(8000).default(''),
  subcontractorNotice: z.string().max(8000).default(''),
  importantNotes: z.string().max(8000).default(''),
  siteManagerSigned: z.boolean().default(false),
  workItems: z.array(constructionDailyLogWorkItemInputSchema).default([]),
  materials: z.array(constructionDailyLogMaterialInputSchema).default([]),
  personnelEquipmentRows: z.array(constructionDailyLogPersonnelEquipmentInputSchema).default([]),
}

export const constructionDailyLogCreateSchema = z.object(baseBody)

export const constructionDailyLogUpdateSchema = z.object(baseBody)

export type ConstructionDailyLogCreateInput = z.infer<typeof constructionDailyLogCreateSchema>
export type ConstructionDailyLogUpdateInput = z.infer<typeof constructionDailyLogUpdateSchema>
