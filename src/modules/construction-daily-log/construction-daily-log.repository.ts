import type { ConstructionDailyLog } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { notDeleted, softDeleteSet } from '../../shared/soft-delete.js'
import type { ConstructionDailyLogCreateInput } from '../../schemas/construction-daily-log.js'
import {
  collectLineageItemsByItemKeys,
  mapLatestApprovedPccesItemIdsToItemKeys,
} from '../pcces-import/pcces-item-lineage.js'

function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return new Date(NaN)
  return new Date(Date.UTC(y, m - 1, d))
}

export const constructionDailyLogRepository = {
  async findDuplicateLogDate(projectId: string, logDate: Date, excludeId?: string): Promise<boolean> {
    const row = await prisma.constructionDailyLog.findFirst({
      where: {
        projectId,
        logDate,
        ...notDeleted,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
    return row != null
  },

  async listByProject(
    projectId: string,
    args: { skip: number; take: number }
  ): Promise<{ rows: ConstructionDailyLog[]; total: number }> {
    const where = { projectId, ...notDeleted }
    const [total, rows] = await Promise.all([
      prisma.constructionDailyLog.count({ where }),
      prisma.constructionDailyLog.findMany({
        where,
        orderBy: { logDate: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
    ])
    return { rows, total }
  },

  async findByIdForProject(projectId: string, logId: string) {
    return prisma.constructionDailyLog.findFirst({
      where: { id: logId, projectId, ...notDeleted },
      include: {
        workItems: {
          orderBy: { sortOrder: 'asc' },
          include: {
            pccesItem: { select: { itemNo: true, itemKind: true, itemKey: true, importId: true } },
          },
        },
        materials: { orderBy: { sortOrder: 'asc' } },
        personnelEquipmentRows: { orderBy: { sortOrder: 'asc' } },
      },
    })
  },

  async create(
    projectId: string,
    userId: string,
    body: ConstructionDailyLogCreateInput
  ): Promise<string> {
    const logDate = parseDateOnly(body.logDate)
    const startDate = body.startDate ? parseDateOnly(body.startDate) : null
    const completionDate = body.completionDate ? parseDateOnly(body.completionDate) : null

    const created = await prisma.$transaction(async (tx) => {
      const log = await tx.constructionDailyLog.create({
        data: {
          projectId,
          createdById: userId,
          reportNo: body.reportNo ?? null,
          weatherAm: body.weatherAm ?? null,
          weatherPm: body.weatherPm ?? null,
          logDate,
          projectName: body.projectName,
          contractorName: body.contractorName,
          approvedDurationDays: body.approvedDurationDays ?? null,
          accumulatedDays: body.accumulatedDays ?? null,
          remainingDays: body.remainingDays ?? null,
          extendedDays: body.extendedDays ?? null,
          startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
          completionDate:
            completionDate && !Number.isNaN(completionDate.getTime()) ? completionDate : null,
          actualProgress:
            body.actualProgress === null || body.actualProgress === undefined
              ? null
              : String(body.actualProgress),
          specialItemA: body.specialItemA,
          specialItemB: body.specialItemB,
          hasTechnician: body.hasTechnician,
          preWorkEducation: body.preWorkEducation,
          newWorkerInsurance: body.newWorkerInsurance,
          ppeCheck: body.ppeCheck,
          otherSafetyNotes: body.otherSafetyNotes,
          sampleTestRecord: body.sampleTestRecord,
          subcontractorNotice: body.subcontractorNotice,
          importantNotes: body.importantNotes,
          siteManagerSigned: body.siteManagerSigned,
        },
      })

      if (body.workItems.length > 0) {
        await tx.constructionDailyLogWorkItem.createMany({
          data: body.workItems.map((w, i) => ({
            logId: log.id,
            sortOrder: i,
            workItemName: w.workItemName,
            unit: w.unit,
            contractQty: w.contractQty,
            unitPrice: w.unitPrice ?? null,
            dailyQty: w.dailyQty,
            accumulatedQty: w.accumulatedQty,
            remark: w.remark,
            pccesItemId: w.pccesItemId ?? null,
          })),
        })
      }
      if (body.materials.length > 0) {
        await tx.constructionDailyLogMaterial.createMany({
          data: body.materials.map((m, i) => ({
            logId: log.id,
            sortOrder: i,
            materialName: m.materialName,
            unit: m.unit,
            contractQty: m.contractQty,
            dailyUsedQty: m.dailyUsedQty,
            accumulatedQty: m.accumulatedQty,
            remark: m.remark,
          })),
        })
      }
      if (body.personnelEquipmentRows.length > 0) {
        await tx.constructionDailyLogPersonnelEquipment.createMany({
          data: body.personnelEquipmentRows.map((p, i) => ({
            logId: log.id,
            sortOrder: i,
            workType: p.workType,
            dailyWorkers: p.dailyWorkers,
            accumulatedWorkers: p.accumulatedWorkers,
            equipmentName: p.equipmentName,
            dailyEquipmentQty: p.dailyEquipmentQty,
            accumulatedEquipmentQty: p.accumulatedEquipmentQty,
          })),
        })
      }

      return log
    })

    return created.id
  },

  async update(
    projectId: string,
    logId: string,
    body: ConstructionDailyLogCreateInput
  ): Promise<boolean> {
    const existing = await prisma.constructionDailyLog.findFirst({
      where: { id: logId, projectId, ...notDeleted },
      select: { id: true },
    })
    if (!existing) return false

    const logDate = parseDateOnly(body.logDate)
    const startDate = body.startDate ? parseDateOnly(body.startDate) : null
    const completionDate = body.completionDate ? parseDateOnly(body.completionDate) : null

    await prisma.$transaction(async (tx) => {
      await tx.constructionDailyLogWorkItem.deleteMany({ where: { logId } })
      await tx.constructionDailyLogMaterial.deleteMany({ where: { logId } })
      await tx.constructionDailyLogPersonnelEquipment.deleteMany({ where: { logId } })

      await tx.constructionDailyLog.update({
        where: { id: logId },
        data: {
          reportNo: body.reportNo ?? null,
          weatherAm: body.weatherAm ?? null,
          weatherPm: body.weatherPm ?? null,
          logDate,
          projectName: body.projectName,
          contractorName: body.contractorName,
          approvedDurationDays: body.approvedDurationDays ?? null,
          accumulatedDays: body.accumulatedDays ?? null,
          remainingDays: body.remainingDays ?? null,
          extendedDays: body.extendedDays ?? null,
          startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
          completionDate:
            completionDate && !Number.isNaN(completionDate.getTime()) ? completionDate : null,
          actualProgress:
            body.actualProgress === null || body.actualProgress === undefined
              ? null
              : String(body.actualProgress),
          specialItemA: body.specialItemA,
          specialItemB: body.specialItemB,
          hasTechnician: body.hasTechnician,
          preWorkEducation: body.preWorkEducation,
          newWorkerInsurance: body.newWorkerInsurance,
          ppeCheck: body.ppeCheck,
          otherSafetyNotes: body.otherSafetyNotes,
          sampleTestRecord: body.sampleTestRecord,
          subcontractorNotice: body.subcontractorNotice,
          importantNotes: body.importantNotes,
          siteManagerSigned: body.siteManagerSigned,
        },
      })

      if (body.workItems.length > 0) {
        await tx.constructionDailyLogWorkItem.createMany({
          data: body.workItems.map((w, i) => ({
            logId,
            sortOrder: i,
            workItemName: w.workItemName,
            unit: w.unit,
            contractQty: w.contractQty,
            unitPrice: w.unitPrice ?? null,
            dailyQty: w.dailyQty,
            accumulatedQty: w.accumulatedQty,
            remark: w.remark,
            pccesItemId: w.pccesItemId ?? null,
          })),
        })
      }
      if (body.materials.length > 0) {
        await tx.constructionDailyLogMaterial.createMany({
          data: body.materials.map((m, i) => ({
            logId,
            sortOrder: i,
            materialName: m.materialName,
            unit: m.unit,
            contractQty: m.contractQty,
            dailyUsedQty: m.dailyUsedQty,
            accumulatedQty: m.accumulatedQty,
            remark: m.remark,
          })),
        })
      }
      if (body.personnelEquipmentRows.length > 0) {
        await tx.constructionDailyLogPersonnelEquipment.createMany({
          data: body.personnelEquipmentRows.map((p, i) => ({
            logId,
            sortOrder: i,
            workType: p.workType,
            dailyWorkers: p.dailyWorkers,
            accumulatedWorkers: p.accumulatedWorkers,
            equipmentName: p.equipmentName,
            dailyEquipmentQty: p.dailyEquipmentQty,
            accumulatedEquipmentQty: p.accumulatedEquipmentQty,
          })),
        })
      }
    })

    return true
  },

  /**
   * 填表日期早於 logDate 之 dailyQty 加總，**依 itemKey 跨已核定 PCCES 版**（不含當日其他日誌）。
   * `pccesItemIds` 須為「目前最新核定版」之工項 id；回傳鍵為該 id，值為同 itemKey 於各版歷史日誌之合計。
   * excludeLogId：更新日誌時排除自身，避免重複計入舊稿。
   */
  async sumDailyQtyByPccesItemsBeforeLogDate(
    projectId: string,
    pccesItemIds: string[],
    logDate: Date,
    excludeLogId?: string
  ): Promise<Map<string, Prisma.Decimal>> {
    const map = new Map<string, Prisma.Decimal>()
    for (const id of pccesItemIds) {
      map.set(id, new Prisma.Decimal(0))
    }
    if (pccesItemIds.length === 0) return map

    const latestIdToKey = await mapLatestApprovedPccesItemIdsToItemKeys(projectId, pccesItemIds)
    const itemKeys = [...new Set(latestIdToKey.values())]
    if (itemKeys.length === 0) return map

    const { lineageIds, lineageIdToItemKey } = await collectLineageItemsByItemKeys(projectId, itemKeys)
    if (lineageIds.length === 0) return map

    const groups = await prisma.constructionDailyLogWorkItem.groupBy({
      by: ['pccesItemId'],
      where: {
        pccesItemId: { in: lineageIds },
        log: {
          projectId,
          ...notDeleted,
          ...(excludeLogId ? { id: { not: excludeLogId } } : {}),
          logDate: { lt: logDate },
        },
      },
      _sum: { dailyQty: true },
    })

    const sumByItemKey = new Map<number, Prisma.Decimal>()
    for (const g of groups) {
      if (!g.pccesItemId) continue
      const key = lineageIdToItemKey.get(g.pccesItemId)
      if (key === undefined) continue
      const add = g._sum.dailyQty ?? new Prisma.Decimal(0)
      sumByItemKey.set(key, (sumByItemKey.get(key) ?? new Prisma.Decimal(0)).plus(add))
    }

    for (const id of pccesItemIds) {
      const key = latestIdToKey.get(id)
      if (key === undefined) continue
      map.set(id, sumByItemKey.get(key) ?? new Prisma.Decimal(0))
    }
    return map
  },

  /**
   * 截至 asOfDateInclusive（UTC 日曆天 **含當日**）之全部施工日誌，加總 **本日完成（dailyQty）**。
   * **依 itemKey 跨已核定版**（與 `sumDailyQtyByPccesItemsBeforeLogDate` 相同聚合方式）。
   * `pccesItemIds` 須為「目前最新核定版」末層 id；回傳鍵為該 id。
   * 供估驗「施工累計」：勿僅取單一列 `accumulatedQty`，以免跨多日時只反映其中一天。
   */
  async sumDailyQtyByPccesItemsThroughDateInclusive(
    projectId: string,
    pccesItemIds: string[],
    asOfDateInclusive: Date
  ): Promise<Map<string, Prisma.Decimal>> {
    const map = new Map<string, Prisma.Decimal>()
    for (const id of pccesItemIds) {
      map.set(id, new Prisma.Decimal(0))
    }
    if (pccesItemIds.length === 0) return map

    const latestIdToKey = await mapLatestApprovedPccesItemIdsToItemKeys(projectId, pccesItemIds)
    const itemKeys = [...new Set(latestIdToKey.values())]
    if (itemKeys.length === 0) return map

    const { lineageIds, lineageIdToItemKey } = await collectLineageItemsByItemKeys(projectId, itemKeys)
    if (lineageIds.length === 0) return map

    const groups = await prisma.constructionDailyLogWorkItem.groupBy({
      by: ['pccesItemId'],
      where: {
        pccesItemId: { in: lineageIds },
        log: {
          projectId,
          ...notDeleted,
          logDate: { lte: asOfDateInclusive },
        },
      },
      _sum: { dailyQty: true },
    })

    const sumByItemKey = new Map<number, Prisma.Decimal>()
    for (const g of groups) {
      if (!g.pccesItemId) continue
      const key = lineageIdToItemKey.get(g.pccesItemId)
      if (key === undefined) continue
      const add = g._sum.dailyQty ?? new Prisma.Decimal(0)
      sumByItemKey.set(key, (sumByItemKey.get(key) ?? new Prisma.Decimal(0)).plus(add))
    }

    for (const id of pccesItemIds) {
      const key = latestIdToKey.get(id)
      if (key === undefined) continue
      map.set(id, sumByItemKey.get(key) ?? new Prisma.Decimal(0))
    }
    return map
  },

  async softDelete(projectId: string, logId: string, deletedById: string): Promise<boolean> {
    const existing = await prisma.constructionDailyLog.findFirst({
      where: { id: logId, projectId, ...notDeleted },
      select: { id: true },
    })
    if (!existing) return false

    await prisma.constructionDailyLog.update({
      where: { id: logId },
      data: softDeleteSet(deletedById),
    })
    return true
  },
}
