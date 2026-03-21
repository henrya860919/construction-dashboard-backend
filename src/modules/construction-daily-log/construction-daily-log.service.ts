import { AppError } from '../../shared/errors.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { prisma } from '../../lib/db.js'
import { notDeleted } from '../../shared/soft-delete.js'
import {
  constructionDailyLogCreateSchema,
  constructionDailyLogUpdateSchema,
} from '../../schemas/construction-daily-log.js'
import { constructionDailyLogRepository } from './construction-daily-log.repository.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

function formatDateOnlyUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 日曆天數（含起訖日）；若 log 早於開工，回傳 0。 */
function elapsedCalendarDaysInclusive(start: Date, log: Date): number {
  const ua = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const ub = Date.UTC(log.getUTCFullYear(), log.getUTCMonth(), log.getUTCDate())
  const diff = Math.floor((ub - ua) / 86400000) + 1
  return Math.max(0, diff)
}

/** 預定進度（%）：依開工日與核定工期線性比例，上限 100；無足夠資料時為 null。 */
export function computePlannedProgressPercent(params: {
  logDate: Date
  startDate: Date | null
  approvedDurationDays: number | null
}): number | null {
  const { logDate, startDate, approvedDurationDays } = params
  if (!startDate || approvedDurationDays == null || approvedDurationDays <= 0) return null
  const elapsed = elapsedCalendarDaysInclusive(startDate, logDate)
  if (elapsed === 0) return 0
  const raw = (elapsed / approvedDurationDays) * 100
  return Math.round(Math.min(100, Math.max(0, raw)) * 100) / 100
}

function serializeDecimal(v: { toString(): string } | null | undefined): string | null {
  if (v === null || v === undefined) return null
  return v.toString()
}

function serializeLog(
  row: NonNullable<Awaited<ReturnType<typeof constructionDailyLogRepository.findByIdForProject>>>
) {
  const plannedProgress = computePlannedProgressPercent({
    logDate: row.logDate,
    startDate: row.startDate,
    approvedDurationDays: row.approvedDurationDays,
  })

  return {
    id: row.id,
    projectId: row.projectId,
    reportNo: row.reportNo,
    weatherAm: row.weatherAm,
    weatherPm: row.weatherPm,
    logDate: formatDateOnlyUtc(row.logDate),
    projectName: row.projectName,
    contractorName: row.contractorName,
    approvedDurationDays: row.approvedDurationDays,
    accumulatedDays: row.accumulatedDays,
    remainingDays: row.remainingDays,
    extendedDays: row.extendedDays,
    startDate: row.startDate ? formatDateOnlyUtc(row.startDate) : null,
    completionDate: row.completionDate ? formatDateOnlyUtc(row.completionDate) : null,
    plannedProgress,
    actualProgress: serializeDecimal(row.actualProgress),
    specialItemA: row.specialItemA,
    specialItemB: row.specialItemB,
    hasTechnician: row.hasTechnician,
    preWorkEducation: row.preWorkEducation,
    newWorkerInsurance: row.newWorkerInsurance,
    ppeCheck: row.ppeCheck,
    otherSafetyNotes: row.otherSafetyNotes,
    sampleTestRecord: row.sampleTestRecord,
    subcontractorNotice: row.subcontractorNotice,
    importantNotes: row.importantNotes,
    siteManagerSigned: row.siteManagerSigned,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workItems: row.workItems.map((w) => ({
      id: w.id,
      workItemName: w.workItemName,
      unit: w.unit,
      contractQty: w.contractQty.toString(),
      dailyQty: w.dailyQty.toString(),
      accumulatedQty: w.accumulatedQty.toString(),
      remark: w.remark,
    })),
    materials: row.materials.map((m) => ({
      id: m.id,
      materialName: m.materialName,
      unit: m.unit,
      contractQty: m.contractQty.toString(),
      dailyUsedQty: m.dailyUsedQty.toString(),
      accumulatedQty: m.accumulatedQty.toString(),
      remark: m.remark,
    })),
    personnelEquipmentRows: row.personnelEquipmentRows.map((p) => ({
      id: p.id,
      workType: p.workType,
      dailyWorkers: p.dailyWorkers,
      accumulatedWorkers: p.accumulatedWorkers,
      equipmentName: p.equipmentName,
      dailyEquipmentQty: p.dailyEquipmentQty.toString(),
      accumulatedEquipmentQty: p.accumulatedEquipmentQty.toString(),
    })),
  }
}

function serializeListRow(
  row: Awaited<ReturnType<typeof constructionDailyLogRepository.listByProject>>['rows'][0]
) {
  const plannedProgress = computePlannedProgressPercent({
    logDate: row.logDate,
    startDate: row.startDate,
    approvedDurationDays: row.approvedDurationDays,
  })
  return {
    id: row.id,
    logDate: formatDateOnlyUtc(row.logDate),
    reportNo: row.reportNo,
    weatherAm: row.weatherAm,
    weatherPm: row.weatherPm,
    projectName: row.projectName,
    plannedProgress,
    actualProgress: serializeDecimal(row.actualProgress),
    createdAt: row.createdAt.toISOString(),
  }
}

export const constructionDailyLogService = {
  async list(projectId: string, user: AuthUser, page: number, limit: number) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'read')
    const skip = (page - 1) * limit
    const { rows, total } = await constructionDailyLogRepository.listByProject(projectId, {
      skip,
      take: limit,
    })
    return {
      data: rows.map(serializeListRow),
      meta: { page, limit, total },
    }
  },

  async getById(projectId: string, logId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'read')
    const row = await constructionDailyLogRepository.findByIdForProject(projectId, logId)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到施工日誌')
    return serializeLog(row)
  },

  async create(projectId: string, user: AuthUser, raw: unknown) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'create')
    const parsed = constructionDailyLogCreateSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', '資料驗證失敗')
    }
    const body = parsed.data
    const logDate = new Date(body.logDate + 'T12:00:00.000Z')
    if (Number.isNaN(logDate.getTime())) {
      throw new AppError(400, 'BAD_REQUEST', '填表日期無效')
    }
    const dup = await constructionDailyLogRepository.findDuplicateLogDate(projectId, logDate)
    if (dup) {
      throw new AppError(409, 'CONFLICT', '該填表日期已有施工日誌')
    }
    const id = await constructionDailyLogRepository.create(projectId, user.id, body)
    const row = await constructionDailyLogRepository.findByIdForProject(projectId, id)
    if (!row) throw new AppError(500, 'INTERNAL_ERROR', '建立後讀取失敗')
    return serializeLog(row)
  },

  async update(projectId: string, logId: string, user: AuthUser, raw: unknown) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'update')
    const parsed = constructionDailyLogUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', '資料驗證失敗')
    }
    const body = parsed.data
    const logDate = new Date(body.logDate + 'T12:00:00.000Z')
    if (Number.isNaN(logDate.getTime())) {
      throw new AppError(400, 'BAD_REQUEST', '填表日期無效')
    }
    const dup = await constructionDailyLogRepository.findDuplicateLogDate(projectId, logDate, logId)
    if (dup) {
      throw new AppError(409, 'CONFLICT', '該填表日期已有其他施工日誌')
    }
    const ok = await constructionDailyLogRepository.update(projectId, logId, body)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到施工日誌')
    const row = await constructionDailyLogRepository.findByIdForProject(projectId, logId)
    if (!row) throw new AppError(500, 'INTERNAL_ERROR', '更新後讀取失敗')
    return serializeLog(row)
  },

  async delete(projectId: string, logId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'delete')
    const ok = await constructionDailyLogRepository.softDelete(projectId, logId, user.id)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到施工日誌')
    return { ok: true as const }
  },

  /** 新增表單預設：取自專案主檔（可再於表單覆寫） */
  async getFormDefaults(projectId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'read')
    const p = await prisma.project.findFirst({
      where: { id: projectId, ...notDeleted },
      select: {
        name: true,
        contractor: true,
        startDate: true,
        plannedDurationDays: true,
      },
    })
    if (!p) throw new AppError(404, 'NOT_FOUND', '找不到專案')
    return {
      projectName: p.name,
      contractorName: p.contractor ?? '',
      startDate: p.startDate ? formatDateOnlyUtc(p.startDate) : null,
      approvedDurationDays: p.plannedDurationDays ?? null,
    }
  },
}
