import type { ParsedPccesRow } from './pcces-xml-parser.js'
import { parentItemKeysWithChildren } from './pcces-item-tree.js'

/** 與 DB `Decimal(18,4)`、前端 `formatEngineeringDecimal` 對齊 */
const DECIMAL_PLACES = 4

function parseNum(s: string): number {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function roundToPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0
  const f = 10 ** DECIMAL_PLACES
  return Math.round(n * f) / f
}

/** 供寫入 Prisma：不含千分位、最多四位小數、去尾隨 0 */
export function engineeringDecimalString(n: number): string {
  const r = roundToPlaces(n)
  if (r === 0) return '0'
  const s = r.toFixed(DECIMAL_PLACES).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

/**
 * 階層金額（匯入解析後、寫入 DB 前）：
 * - **葉節點**（無子 PayItem 對應列）：複價 = 數量 × 單價（itemKind 可為 general／formula／variablePrice 等）
 * - **非葉**：複價 = **直接子列**複價加總；單價 = 複價 ÷ 數量（數量 > 0；否則單價為 0）
 */
export function applyPccesComputedAmounts(rows: ParsedPccesRow[]): void {
  if (rows.length === 0) return

  const parentsWithChildren = parentItemKeysWithChildren(rows)

  const childrenByParent = new Map<number, ParsedPccesRow[]>()
  for (const r of rows) {
    const pk = r.parentItemKey
    if (pk === null) continue
    const list = childrenByParent.get(pk)
    if (list) list.push(r)
    else childrenByParent.set(pk, [r])
  }

  let maxDepth = 0
  for (const r of rows) {
    if (r.depth > maxDepth) maxDepth = r.depth
  }

  for (let d = maxDepth; d >= 1; d--) {
    for (const r of rows) {
      if (r.depth !== d) continue

      const isLeaf = !parentsWithChildren.has(r.itemKey)
      if (isLeaf) {
        const amt = parseNum(r.quantity) * parseNum(r.unitPrice)
        r.amountImported = engineeringDecimalString(amt)
        continue
      }

      const kids = childrenByParent.get(r.itemKey) ?? []
      let sum = 0
      for (const k of kids) {
        const a = k.amountImported != null ? parseNum(k.amountImported) : 0
        sum += a
      }
      r.amountImported = engineeringDecimalString(sum)
      const q = parseNum(r.quantity)
      r.unitPrice = q > 0 ? engineeringDecimalString(roundToPlaces(sum / q)) : '0'
    }
  }
}
