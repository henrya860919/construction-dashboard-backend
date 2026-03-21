import { Prisma } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { prisma } from '../../lib/db.js'
import { notDeleted } from '../../shared/soft-delete.js'
import type { ConstructionDailyLogCreateInput } from '../../schemas/construction-daily-log.js'
import {
  constructionDailyLogCreateSchema,
  constructionDailyLogUpdateSchema,
} from '../../schemas/construction-daily-log.js'
import { pccesImportRepository } from '../pcces-import/pcces-import.repository.js'
import {
  allowsUserEnteredQtyForPccesItemKind,
  isStructuralLeaf,
  parentItemKeysWithChildren,
} from '../pcces-import/pcces-item-tree.js'
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

function decQty(s: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(s)
  } catch {
    return new Prisma.Decimal(0)
  }
}

async function normalizeConstructionDailyLogBody(
  projectId: string,
  logDate: Date,
  excludeLogId: string | undefined,
  body: ConstructionDailyLogCreateInput
): Promise<ConstructionDailyLogCreateInput> {
  const seen = new Set<string>()
  for (const w of body.workItems) {
    if (w.pccesItemId) {
      if (seen.has(w.pccesItemId)) {
        throw new AppError(400, 'VALIDATION_ERROR', '同一日誌不可重複綁定相同 PCCES 工項')
      }
      seen.add(w.pccesItemId)
    }
  }

  const pccesIds = body.workItems
    .map((w) => w.pccesItemId)
    .filter((id): id is string => Boolean(id))

  const latest = await pccesImportRepository.findLatestApprovedImport(projectId)

  let priorMap = new Map<string, Prisma.Decimal>()
  if (pccesIds.length > 0) {
    if (!latest) {
      throw new AppError(400, 'PCCES_NOT_APPROVED', '專案尚無核定之 PCCES 版本，無法綁定工項')
    }
    priorMap = await constructionDailyLogRepository.sumDailyQtyByPccesItemsBeforeLogDate(
      projectId,
      pccesIds,
      logDate,
      excludeLogId
    )
  }

  const treeShape =
    pccesIds.length === 0
      ? []
      : await prisma.pccesItem.findMany({
          where: { importId: latest!.id, ...notDeleted },
          select: { itemKey: true, parentItemKey: true },
        })
  const parentsWithChildren = parentItemKeysWithChildren(treeShape)

  const items =
    pccesIds.length === 0
      ? []
      : await prisma.pccesItem.findMany({
          where: {
            id: { in: pccesIds },
            importId: latest!.id,
            ...notDeleted,
          },
        })

  const itemById = new Map(items.map((i) => [i.id, i]))

  const nextWork: ConstructionDailyLogCreateInput['workItems'] = []

  for (const w of body.workItems) {
    if (!w.pccesItemId) {
      const contract = decQty(w.contractQty)
      const daily = decQty(w.dailyQty)
      const acc = decQty(w.accumulatedQty)
      if (daily.isNeg()) {
        throw new AppError(400, 'VALIDATION_ERROR', '本日完成數量不可為負')
      }
      if (acc.isNeg()) {
        throw new AppError(400, 'VALIDATION_ERROR', '累計完成數量不可為負')
      }
      if (acc.lt(daily)) {
        throw new AppError(400, 'VALIDATION_ERROR', '累計完成數量不可小於本日完成數量')
      }
      if (acc.gt(contract)) {
        throw new AppError(400, 'WORK_ITEM_QTY_EXCEEDED', '累計完成數量不可超過契約數量')
      }
      nextWork.push({
        workItemName: w.workItemName,
        unit: w.unit,
        contractQty: w.contractQty,
        dailyQty: w.dailyQty,
        accumulatedQty: w.accumulatedQty,
        remark: w.remark,
      })
      continue
    }

    const item = itemById.get(w.pccesItemId)
    if (!item || !isStructuralLeaf(item, parentsWithChildren)) {
      throw new AppError(
        400,
        'BAD_REQUEST',
        'PCCES 工項無效、非末層或不在目前核定版本中'
      )
    }

    const daily = decQty(w.dailyQty)
    if (daily.isNeg()) {
      throw new AppError(400, 'VALIDATION_ERROR', '本日完成數量不可為負')
    }
    if (!allowsUserEnteredQtyForPccesItemKind(item.itemKind) && !daily.isZero()) {
      throw new AppError(400, 'VALIDATION_ERROR', '此 PCCES 類型不可填寫本日完成數量')
    }

    const prior = priorMap.get(w.pccesItemId) ?? new Prisma.Decimal(0)
    /** 契約數／名稱／單位以請求正文快照為準，避免換版後覆寫歷史日誌列 */
    const contract = decQty(w.contractQty)
    if (contract.isNeg()) {
      throw new AppError(400, 'VALIDATION_ERROR', '契約數量不可為負')
    }
    const accumulated = prior.plus(daily)
    if (accumulated.gt(contract)) {
      throw new AppError(400, 'WORK_ITEM_QTY_EXCEEDED', '累計完成數量不可超過契約數量')
    }

    const pccesRow: ConstructionDailyLogCreateInput['workItems'][number] = {
      pccesItemId: item.id,
      workItemName: w.workItemName,
      unit: w.unit,
      contractQty: contract.toString(),
      dailyQty: daily.toString(),
      accumulatedQty: accumulated.toString(),
      remark: w.remark,
    }
    if (w.unitPrice !== undefined) {
      pccesRow.unitPrice = decQty(w.unitPrice).toString()
    }
    nextWork.push(pccesRow)
  }

  return { ...body, workItems: nextWork }
}

async function structuralLeafByPccesItemId(
  workItems: {
    pccesItemId: string | null
    pccesItem: { importId: string; itemKey: number } | null
  }[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  const importIds = new Set<string>()
  for (const w of workItems) {
    if (w.pccesItemId && w.pccesItem) importIds.add(w.pccesItem.importId)
  }
  const parentsByImport = new Map<string, Set<number>>()
  for (const iid of importIds) {
    const shape = await prisma.pccesItem.findMany({
      where: { importId: iid, ...notDeleted },
      select: { itemKey: true, parentItemKey: true },
    })
    parentsByImport.set(iid, parentItemKeysWithChildren(shape))
  }
  for (const w of workItems) {
    if (!w.pccesItemId || !w.pccesItem) continue
    const parents = parentsByImport.get(w.pccesItem.importId)
    if (!parents) continue
    map.set(
      w.pccesItemId,
      isStructuralLeaf({ itemKey: w.pccesItem.itemKey }, parents)
    )
  }
  return map
}

async function serializeLog(
  row: NonNullable<Awaited<ReturnType<typeof constructionDailyLogRepository.findByIdForProject>>>
) {
  const plannedProgress = computePlannedProgressPercent({
    logDate: row.logDate,
    startDate: row.startDate,
    approvedDurationDays: row.approvedDurationDays,
  })

  const leafByPccesItemId = await structuralLeafByPccesItemId(row.workItems)

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
      pccesItemId: w.pccesItemId,
      itemNo: w.pccesItem?.itemNo ?? null,
      pccesItemKind: w.pccesItem?.itemKind ?? null,
      pccesStructuralLeaf:
        w.pccesItemId == null
          ? null
          : (leafByPccesItemId.get(w.pccesItemId) ?? true),
      workItemName: w.workItemName,
      unit: w.unit,
      contractQty: w.contractQty.toString(),
      unitPrice: w.unitPrice != null ? w.unitPrice.toString() : null,
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
    return await serializeLog(row)
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
    const normalized = await normalizeConstructionDailyLogBody(projectId, logDate, undefined, body)
    const id = await constructionDailyLogRepository.create(projectId, user.id, normalized)
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
    const normalized = await normalizeConstructionDailyLogBody(projectId, logDate, logId, body)
    const ok = await constructionDailyLogRepository.update(projectId, logId, normalized)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到施工日誌')
    const row = await constructionDailyLogRepository.findByIdForProject(projectId, logId)
    if (!row) throw new AppError(500, 'INTERNAL_ERROR', '更新後讀取失敗')
    return await serializeLog(row)
  },

  async delete(projectId: string, logId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'delete')
    const ok = await constructionDailyLogRepository.softDelete(projectId, logId, user.id)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到施工日誌')
    return { ok: true as const }
  },

  /**
   * 施工日誌（一）工項選擇器：**樹狀與 pccesItemId 為「最新核定版」**（儲存時與 normalize 一致）；
   * **契約數量、單價、工程名稱、單位**依 **填表日** 對應之「當日有效核定版」以 **itemKey** 覆寫（3/21 仍見舊版數字，3/22 起見新版）。
   * 累計（迄前日）仍依 itemKey 跨版加總。排序同「PCCES 明細」：**itemKey 升序**；`isStructuralLeaf` false 為目錄列。
   */
  async getPccesWorkItemPicker(
    projectId: string,
    user: AuthUser,
    logDateIso: string,
    excludeLogId?: string
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.diary', 'read')
    const logDate = new Date(`${logDateIso}T12:00:00.000Z`)
    if (Number.isNaN(logDate.getTime())) {
      throw new AppError(400, 'BAD_REQUEST', '填表日期無效')
    }
    const latest = await pccesImportRepository.findLatestApprovedImport(projectId)
    const effective = await pccesImportRepository.findApprovedImportEffectiveOnLogDate(
      projectId,
      logDate
    )
    type RowOut = {
      pccesItemId: string
      itemKey: number
      parentItemKey: number | null
      itemNo: string
      itemKind: string
      workItemName: string
      unit: string
      contractQty: string
      unitPrice: string
      isStructuralLeaf: boolean
      /** 非末層為 null */
      priorAccumulatedQty: string | null
    }
    type GroupOut = {
      parent: { itemNo: string; workItemName: string; unit: string } | null
      children: RowOut[]
    }
    if (!latest || !effective) {
      return {
        pccesImport: null as null,
        rows: [] as RowOut[],
        groups: [] as GroupOut[],
        items: [] as RowOut[],
      }
    }

    const asOfItems =
      effective.id === latest.id
        ? null
        : await prisma.pccesItem.findMany({
            where: { importId: effective.id, ...notDeleted },
            select: {
              itemKey: true,
              itemNo: true,
              description: true,
              unit: true,
              quantity: true,
              unitPrice: true,
            },
          })
    const asOfByItemKey = new Map(
      (asOfItems ?? []).map((x) => [
        x.itemKey,
        {
          itemNo: x.itemNo,
          description: x.description,
          unit: x.unit,
          quantity: x.quantity,
          unitPrice: x.unitPrice,
        },
      ])
    )

    const allItems = await prisma.pccesItem.findMany({
      where: { importId: latest.id, ...notDeleted },
      orderBy: { itemKey: 'asc' },
      select: {
        id: true,
        itemKey: true,
        parentItemKey: true,
        itemKind: true,
        itemNo: true,
        description: true,
        unit: true,
        quantity: true,
        unitPrice: true,
      },
    })
    const parentsWithChildrenPicker = parentItemKeysWithChildren(allItems)
    const leafIds = new Set(
      allItems.filter((i) => isStructuralLeaf(i, parentsWithChildrenPicker)).map((i) => i.id)
    )
    const leafIdList = [...leafIds]

    const priorMap =
      leafIdList.length === 0
        ? new Map<string, Prisma.Decimal>()
        : await constructionDailyLogRepository.sumDailyQtyByPccesItemsBeforeLogDate(
            projectId,
            leafIdList,
            logDate,
            excludeLogId
          )

    const rows: RowOut[] = allItems.map((r) => {
      const isLeaf = leafIds.has(r.id)
      const snap = asOfByItemKey.get(r.itemKey)
      const itemNo = snap?.itemNo ?? r.itemNo
      const desc = snap?.description ?? r.description
      const unit = snap?.unit ?? r.unit
      const qty = snap?.quantity ?? r.quantity
      const price = snap?.unitPrice ?? r.unitPrice
      return {
        pccesItemId: r.id,
        itemKey: r.itemKey,
        parentItemKey: r.parentItemKey,
        itemNo,
        itemKind: r.itemKind,
        workItemName: desc,
        unit,
        contractQty: qty.toString(),
        unitPrice: price.toString(),
        isStructuralLeaf: isLeaf,
        priorAccumulatedQty: isLeaf
          ? (priorMap.get(r.id) ?? new Prisma.Decimal(0)).toString()
          : null,
      }
    })

    const items = rows.filter((x) => x.isStructuralLeaf)

    /** 回傳「契約欄位所依版本」（填表日有效版），與 `pccesItemId` 所屬之最新版可能不同 */
    const importMeta = await pccesImportRepository.findByIdForProject(projectId, effective.id)
    return {
      pccesImport: importMeta
        ? {
            id: importMeta.id,
            version: importMeta.version,
            approvedAt: importMeta.approvedAt?.toISOString() ?? null,
            approvedById: importMeta.approvedById,
          }
        : {
            id: effective.id,
            version: effective.version,
            approvedAt: null as string | null,
            approvedById: null as string | null,
          },
      rows,
      groups: [] as GroupOut[],
      items,
    }
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
