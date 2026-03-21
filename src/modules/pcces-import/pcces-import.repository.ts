import { prisma } from '../../lib/db.js'
import { notDeleted, softDeleteSet } from '../../shared/soft-delete.js'
import type { ParsedPccesRow } from './pcces-xml-parser.js'
import { parentItemKeysWithChildren } from './pcces-item-tree.js'

function utcCalendarDay(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export type PccesImportListRow = {
  id: string
  projectId: string
  version: number
  versionLabel: string | null
  documentType: string | null
  fileName: string
  attachmentId: string | null
  itemCount: number
  generalCount: number
  approvedAt: Date | null
  approvedById: string | null
  createdAt: Date
  createdById: string
}

export type PccesItemRow = {
  id: string
  importId: string
  itemKey: number
  parentItemKey: number | null
  itemNo: string
  itemKind: string
  refCode: string
  description: string
  unit: string
  quantity: string
  unitPrice: string
  amountImported: string | null
  remark: string
  percent: string | null
  path: string
  depth: number
}

export const pccesImportRepository = {
  /**
   * 列表／詳情顯示用：依子表即時計算（未軟刪工項），不依賴 import 上快取欄位。
   */
  async countActiveItemsByImportIds(
    importIds: string[]
  ): Promise<Map<string, { itemCount: number; generalCount: number }>> {
    if (importIds.length === 0) return new Map()
    const map = new Map(importIds.map((id) => [id, { itemCount: 0, generalCount: 0 }]))
    const rows = await prisma.pccesItem.findMany({
      where: { importId: { in: importIds }, ...notDeleted },
      select: { importId: true, itemKey: true, parentItemKey: true },
    })
    const byImport = new Map<string, { itemKey: number; parentItemKey: number | null }[]>()
    for (const r of rows) {
      const list = byImport.get(r.importId) ?? []
      list.push({ itemKey: r.itemKey, parentItemKey: r.parentItemKey })
      byImport.set(r.importId, list)
    }
    for (const id of importIds) {
      const list = byImport.get(id) ?? []
      const pw = parentItemKeysWithChildren(list)
      let leafCount = 0
      for (const r of list) {
        if (!pw.has(r.itemKey)) leafCount++
      }
      map.set(id, { itemCount: list.length, generalCount: leafCount })
    }
    return map
  },

  /** 版本號全專案遞增；含已軟刪列，避免與 @@unique([projectId, version]) 衝突 */
  async getNextVersion(projectId: string): Promise<number> {
    const agg = await prisma.pccesImport.aggregate({
      where: { projectId },
      _max: { version: true },
    })
    return (agg._max.version ?? 0) + 1
  },

  async createImportWithItems(
    projectId: string,
    userId: string,
    fileName: string,
    documentType: string | null,
    rows: ParsedPccesRow[],
    attachmentId: string | null,
    versionLabel: string | null
  ): Promise<PccesImportListRow> {
    const version = await this.getNextVersion(projectId)
    const pw = parentItemKeysWithChildren(rows)
    const generalCount = rows.filter((r) => !pw.has(r.itemKey)).length

    const created = await prisma.$transaction(async (tx) => {
      const imp = await tx.pccesImport.create({
        data: {
          projectId,
          version,
          versionLabel,
          documentType,
          fileName,
          attachmentId,
          itemCount: rows.length,
          generalCount,
          createdById: userId,
        },
      })

      const chunk = 400
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk)
        await tx.pccesItem.createMany({
          data: slice.map((r) => ({
            importId: imp.id,
            itemKey: r.itemKey,
            parentItemKey: r.parentItemKey,
            itemNo: r.itemNo,
            itemKind: r.itemKind,
            refCode: r.refCode,
            description: r.description,
            unit: r.unit,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            amountImported: r.amountImported ?? null,
            remark: r.remark,
            percent: r.percent ?? null,
            path: r.path,
            depth: r.depth,
          })),
        })
      }

      return imp
    })

    return {
      id: created.id,
      projectId: created.projectId,
      version: created.version,
      versionLabel: created.versionLabel,
      documentType: created.documentType,
      fileName: created.fileName,
      attachmentId: created.attachmentId,
      itemCount: created.itemCount,
      generalCount: created.generalCount,
      approvedAt: created.approvedAt,
      approvedById: created.approvedById,
      createdAt: created.createdAt,
      createdById: created.createdById,
    }
  },

  async updateAttachmentId(importId: string, attachmentId: string): Promise<void> {
    await prisma.pccesImport.update({
      where: { id: importId, ...notDeleted },
      data: { attachmentId },
    })
  },

  async listByProject(projectId: string): Promise<PccesImportListRow[]> {
    const rows = await prisma.pccesImport.findMany({
      where: { projectId, ...notDeleted },
      orderBy: { version: 'desc' },
    })
    const stats = await this.countActiveItemsByImportIds(rows.map((r) => r.id))
    return rows.map((r) => {
      const c = stats.get(r.id) ?? { itemCount: 0, generalCount: 0 }
      return {
        id: r.id,
        projectId: r.projectId,
        version: r.version,
        versionLabel: r.versionLabel,
        documentType: r.documentType,
        fileName: r.fileName,
        attachmentId: r.attachmentId,
        itemCount: c.itemCount,
        generalCount: c.generalCount,
        approvedAt: r.approvedAt,
        approvedById: r.approvedById,
        createdAt: r.createdAt,
        createdById: r.createdById,
      }
    })
  },

  /** 專案內「最新核定版」：已核定中 version 最大者（施工日誌工項來源） */
  async findLatestApprovedImport(projectId: string): Promise<{ id: string; version: number } | null> {
    const row = await prisma.pccesImport.findFirst({
      where: { projectId, approvedAt: { not: null }, ...notDeleted },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    })
    return row
  },

  /**
   * 在 **填表日**（UTC 日曆天）當日或之前已完成核定之匯入中，取 **version 最大** 者。
   * 例：3/22 核定新版後，填表日 3/21 仍對應舊版；填表日 3/22 起對應含當日核定之新版。
   */
  async findApprovedImportEffectiveOnLogDate(
    projectId: string,
    logDate: Date
  ): Promise<{ id: string; version: number } | null> {
    const logDay = utcCalendarDay(logDate)
    const rows = await prisma.pccesImport.findMany({
      where: { projectId, approvedAt: { not: null }, ...notDeleted },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, approvedAt: true },
    })
    for (const r of rows) {
      const a = r.approvedAt
      if (!a) continue
      if (utcCalendarDay(a) <= logDay) {
        return { id: r.id, version: r.version }
      }
    }
    return null
  },

  async approveImport(projectId: string, importId: string, approvedById: string): Promise<boolean> {
    const existing = await prisma.pccesImport.findFirst({
      where: { id: importId, projectId, ...notDeleted },
      select: { id: true, approvedAt: true },
    })
    if (!existing) return false
    if (existing.approvedAt != null) return true
    await prisma.pccesImport.update({
      where: { id: importId },
      data: { approvedAt: new Date(), approvedById },
    })
    return true
  },

  async findByIdForProject(
    projectId: string,
    importId: string
  ): Promise<PccesImportListRow | null> {
    const r = await prisma.pccesImport.findFirst({
      where: { id: importId, projectId, ...notDeleted },
    })
    if (!r) return null
    const stats = await this.countActiveItemsByImportIds([r.id])
    const c = stats.get(r.id) ?? { itemCount: 0, generalCount: 0 }
    return {
      id: r.id,
      projectId: r.projectId,
      version: r.version,
      versionLabel: r.versionLabel,
      documentType: r.documentType,
      fileName: r.fileName,
      attachmentId: r.attachmentId,
      itemCount: c.itemCount,
      generalCount: c.generalCount,
      approvedAt: r.approvedAt,
      approvedById: r.approvedById,
      createdAt: r.createdAt,
      createdById: r.createdById,
    }
  },

  async updateVersionLabel(
    projectId: string,
    importId: string,
    versionLabel: string | null
  ): Promise<boolean> {
    const r = await prisma.pccesImport.updateMany({
      where: { id: importId, projectId, ...notDeleted },
      data: { versionLabel },
    })
    return r.count > 0
  },

  async countItems(
    importId: string,
    itemKind?: string
  ): Promise<number> {
    return prisma.pccesItem.count({
      where: {
        importId,
        ...notDeleted,
        ...(itemKind ? { itemKind } : {}),
      },
    })
  },

  async listItems(
    importId: string,
    options: { skip: number; take: number; itemKind?: string }
  ): Promise<PccesItemRow[]> {
    const rows = await prisma.pccesItem.findMany({
      where: {
        importId,
        ...notDeleted,
        ...(options.itemKind ? { itemKind: options.itemKind } : {}),
      },
      orderBy: { itemKey: 'asc' },
      skip: options.skip,
      take: options.take,
    })
    return rows.map((r) => ({
      id: r.id,
      importId: r.importId,
      itemKey: r.itemKey,
      parentItemKey: r.parentItemKey,
      itemNo: r.itemNo,
      itemKind: r.itemKind,
      refCode: r.refCode,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity.toString(),
      unitPrice: r.unitPrice.toString(),
      amountImported: r.amountImported?.toString() ?? null,
      remark: r.remark,
      percent: r.percent?.toString() ?? null,
      path: r.path,
      depth: r.depth,
    }))
  },

  /**
   * 軟刪除該次匯入及其底下工項；回傳歸檔 attachmentId（若有）供後續刪檔。
   */
  async softDeleteImport(
    projectId: string,
    importId: string,
    deletedById: string
  ): Promise<{ attachmentId: string | null } | null> {
    const existing = await prisma.pccesImport.findFirst({
      where: { id: importId, projectId, ...notDeleted },
      select: { id: true, attachmentId: true },
    })
    if (!existing) return null

    await prisma.$transaction(async (tx) => {
      await tx.pccesItemChange.updateMany({
        where: { importId: existing.id, ...notDeleted },
        data: softDeleteSet(deletedById),
      })
      await tx.pccesItem.updateMany({
        where: { importId: existing.id, ...notDeleted },
        data: softDeleteSet(deletedById),
      })
      await tx.pccesImport.updateMany({
        where: { id: existing.id, ...notDeleted },
        data: softDeleteSet(deletedById),
      })
    })

    return { attachmentId: existing.attachmentId }
  },
}
