/**
 * PCCES 工項樹：親子僅能依 itemKey／parentItemKey（或巢狀）判斷，勿用 itemNo。
 * 「葉節點」＝沒有任何子列的 parentItemKey 指向本列之 itemKey。
 */

export function parentItemKeysWithChildren(
  rows: readonly { parentItemKey: number | null }[]
): Set<number> {
  const s = new Set<number>()
  for (const r of rows) {
    if (r.parentItemKey != null) s.add(r.parentItemKey)
  }
  return s
}

export function isStructuralLeaf<T extends { itemKey: number }>(
  row: T,
  parentsWithChildren: Set<number>
): boolean {
  return !parentsWithChildren.has(row.itemKey)
}

/** 施工日誌／估驗是否允許使用者填寫數量；其餘 XML kind 僅能為 0（由後端再驗證） */
export function allowsUserEnteredQtyForPccesItemKind(itemKind: string): boolean {
  const k = itemKind.trim()
  return k === '' || k === 'general'
}
