import { prisma } from '../../lib/db.js'
import { notDeleted } from '../../shared/soft-delete.js'

/**
 * 施工日誌／估驗：同一專案內「邏輯工項」以 itemKey 對齊；換版後 PccesItem.id 變但 itemKey 沿用。
 * 僅納入 **已核定** 之 PCCES 匯入版本。
 */

/** 目前「最新核定版」之 import id；無則 null */
export async function findLatestApprovedImportId(projectId: string): Promise<string | null> {
  const row = await prisma.pccesImport.findFirst({
    where: { projectId, approvedAt: { not: null }, ...notDeleted },
    orderBy: { version: 'desc' },
    select: { id: true },
  })
  return row?.id ?? null
}

/** 僅接受最新核定版上的工項 id → itemKey */
export async function mapLatestApprovedPccesItemIdsToItemKeys(
  projectId: string,
  pccesItemIds: string[]
): Promise<Map<string, number>> {
  const latestId = await findLatestApprovedImportId(projectId)
  if (!latestId || pccesItemIds.length === 0) return new Map()
  const rows = await prisma.pccesItem.findMany({
    where: { id: { in: pccesItemIds }, importId: latestId, ...notDeleted },
    select: { id: true, itemKey: true },
  })
  return new Map(rows.map((r) => [r.id, r.itemKey]))
}

export type LineageMaps = {
  /** 所有已核定版中，指定 itemKeys 對應到的 PccesItem.id */
  lineageIds: string[]
  /** 任一族譜列 id → itemKey */
  lineageIdToItemKey: Map<string, number>
}

/** 專案內所有已核定版中，itemKey ∈ keys 的工項（含各版 id） */
export async function collectLineageItemsByItemKeys(
  projectId: string,
  itemKeys: number[]
): Promise<LineageMaps> {
  const uniqueKeys = [...new Set(itemKeys)]
  if (uniqueKeys.length === 0) {
    return { lineageIds: [], lineageIdToItemKey: new Map() }
  }
  const imports = await prisma.pccesImport.findMany({
    where: { projectId, approvedAt: { not: null }, ...notDeleted },
    select: { id: true },
  })
  const importIds = imports.map((i) => i.id)
  if (importIds.length === 0) {
    return { lineageIds: [], lineageIdToItemKey: new Map() }
  }
  const items = await prisma.pccesItem.findMany({
    where: {
      importId: { in: importIds },
      itemKey: { in: uniqueKeys },
      ...notDeleted,
    },
    select: { id: true, itemKey: true },
  })
  const lineageIdToItemKey = new Map(items.map((r) => [r.id, r.itemKey]))
  const lineageIds = items.map((r) => r.id)
  return { lineageIds, lineageIdToItemKey }
}
