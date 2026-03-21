import { prisma } from '../../lib/db.js'
import { notDeleted, softDeleteSet } from '../../shared/soft-delete.js'
import type { ParsedPccesRow } from './pcces-xml-parser.js'

export type PccesImportListRow = {
  id: string
  projectId: string
  version: number
  documentType: string | null
  fileName: string
  attachmentId: string | null
  itemCount: number
  generalCount: number
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
    const [allGroups, genGroups] = await Promise.all([
      prisma.pccesItem.groupBy({
        by: ['importId'],
        where: { importId: { in: importIds }, ...notDeleted },
        _count: { _all: true },
      }),
      prisma.pccesItem.groupBy({
        by: ['importId'],
        where: {
          importId: { in: importIds },
          itemKind: 'general',
          ...notDeleted,
        },
        _count: { _all: true },
      }),
    ])
    const map = new Map(
      importIds.map((id) => [id, { itemCount: 0, generalCount: 0 }])
    )
    for (const g of allGroups) {
      const cur = map.get(g.importId)
      if (cur) cur.itemCount = g._count._all
    }
    for (const g of genGroups) {
      const cur = map.get(g.importId)
      if (cur) cur.generalCount = g._count._all
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
    attachmentId: string | null
  ): Promise<PccesImportListRow> {
    const version = await this.getNextVersion(projectId)
    const generalCount = rows.filter((r) => r.itemKind === 'general').length

    const created = await prisma.$transaction(async (tx) => {
      const imp = await tx.pccesImport.create({
        data: {
          projectId,
          version,
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
      documentType: created.documentType,
      fileName: created.fileName,
      attachmentId: created.attachmentId,
      itemCount: created.itemCount,
      generalCount: created.generalCount,
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
        documentType: r.documentType,
        fileName: r.fileName,
        attachmentId: r.attachmentId,
        itemCount: c.itemCount,
        generalCount: c.generalCount,
        createdAt: r.createdAt,
        createdById: r.createdById,
      }
    })
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
      documentType: r.documentType,
      fileName: r.fileName,
      attachmentId: r.attachmentId,
      itemCount: c.itemCount,
      generalCount: c.generalCount,
      createdAt: r.createdAt,
      createdById: r.createdById,
    }
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
