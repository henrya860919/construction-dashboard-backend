import { XMLParser } from 'fast-xml-parser'
import { AppError } from '../../shared/errors.js'
import { applyPccesComputedAmounts } from './pcces-amount-rollup.js'

export type ParsedPccesRow = {
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

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name: string) => ['PayItem', 'Description', 'Unit'].includes(name),
  removeNSPrefix: true,
} as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function ensureArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function textFromNode(n: unknown): string {
  if (typeof n === 'string') return n.trim()
  if (typeof n === 'number' && !Number.isNaN(n)) return String(n)
  if (!isRecord(n)) return ''
  const t = n['#text']
  if (typeof t === 'string') return t.trim()
  if (typeof t === 'number') return String(t)
  if (Array.isArray(t)) return t.map((x) => String(x)).join('').trim()
  return ''
}

/** Description / Unit：取 language="zh-TW" 的 #text */
function pickLangText(nodes: unknown, lang: string): string {
  const arr = ensureArray(nodes)
  for (const n of arr) {
    if (typeof n === 'string') continue
    if (!isRecord(n)) continue
    const l = String(n['@_language'] ?? n['@_lang'] ?? '').trim()
    if (l === lang) {
      const t = textFromNode(n)
      if (t) return t
    }
  }
  if (arr.length > 0) {
    return textFromNode(arr[0])
  }
  return ''
}

function scalarString(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v)
  if (typeof v === 'string') return v.trim().replace(/,/g, '')
  if (isRecord(v) && '#text' in v) {
    return String(v['#text']).trim().replace(/,/g, '')
  }
  return ''
}

function parseDecimalString(v: unknown): string {
  const s = scalarString(v)
  if (!s) return '0'
  const n = parseFloat(s)
  if (Number.isNaN(n)) return '0'
  return String(n)
}

function amountImportedString(v: unknown): string | null {
  const s = scalarString(v)
  if (!s) return null
  const n = parseFloat(s)
  if (Number.isNaN(n)) return null
  return String(n)
}

function parsePercentValue(v: unknown): string | null {
  const s = scalarString(v)
  if (!s) return null
  const n = parseFloat(s)
  if (Number.isNaN(n)) return null
  return String(n)
}

/** Remark：可能是字串、#text 物件或多語節點 */
function pickRemark(raw: Record<string, unknown>): string {
  const nodes = raw.Remark
  if (nodes === undefined || nodes === null) return ''
  const arr = ensureArray(nodes)
  if (arr.length > 0 && arr.some((n) => isRecord(n) && ('@_language' in n || '@_lang' in n))) {
    const t = pickLangText(nodes, 'zh-TW')
    if (t) return t
  }
  const flat = scalarString(nodes)
  if (flat) return flat
  return pickLangText(nodes, 'zh-TW')
}

type BreadcrumbEntry = { itemNo: string; desc: string; itemKey: number }

const ALLOWED_KINDS = new Set(['mainItem', 'general'])

function findEtenderSheet(obj: unknown): Record<string, unknown> | null {
  if (!isRecord(obj)) return null
  if ('ETenderSheet' in obj) {
    const s = obj.ETenderSheet
    if (isRecord(s)) return s
    const a = ensureArray(s)[0]
    return isRecord(a) ? a : null
  }
  for (const v of Object.values(obj)) {
    const found = findEtenderSheet(v)
    if (found) return found
  }
  return null
}

function traversePayItems(
  payItems: unknown,
  parentItemKey: number | null,
  breadcrumb: BreadcrumbEntry[],
  out: ParsedPccesRow[]
): void {
  const list = ensureArray(payItems)
  for (const raw of list) {
    if (!isRecord(raw)) continue

    const itemKindRaw = String(raw['@_itemKind'] ?? '').trim()
    if (!ALLOWED_KINDS.has(itemKindRaw)) continue

    const itemKeyParsed = parseInt(String(raw['@_itemKey'] ?? ''), 10)
    if (Number.isNaN(itemKeyParsed)) {
      throw new AppError(400, 'PCCES_XML_INVALID', 'PayItem 缺少有效 itemKey')
    }

    const itemNo = String(raw['@_itemNo'] ?? '').trim()
    const refCode = String(raw['@_refItemCode'] ?? '').trim()
    const description = pickLangText(raw.Description, 'zh-TW')
    const unit = pickLangText(raw.Unit, 'zh-TW')
    const quantity = parseDecimalString(raw.Quantity)
    const unitPrice = parseDecimalString(raw.Price)
    const amountImported = amountImportedString(raw.Amount)
    const remark = pickRemark(raw)
    const percent = parsePercentValue(raw.Percent)

    const currentPath: BreadcrumbEntry[] = [
      ...breadcrumb,
      { itemNo, desc: description, itemKey: itemKeyParsed },
    ]
    const pathStr = currentPath.map((p) => `${p.itemNo} ${p.desc}`.trim()).join(' > ')
    const depth = currentPath.length

    out.push({
      itemKey: itemKeyParsed,
      parentItemKey: parentItemKey,
      itemNo,
      itemKind: itemKindRaw,
      refCode,
      description,
      unit,
      quantity,
      unitPrice,
      amountImported,
      remark,
      percent,
      path: pathStr,
      depth,
    })

    const nested = raw.PayItem
    if (nested !== undefined && nested !== null) {
      traversePayItems(nested, itemKeyParsed, currentPath, out)
    }
  }
}

export async function parsePccesXmlBuffer(buffer: Buffer): Promise<{
  documentType: string | null
  rows: ParsedPccesRow[]
}> {
  const xml = buffer.toString('utf-8').trim()
  if (!xml) {
    throw new AppError(400, 'BAD_REQUEST', 'XML 內容為空')
  }

  const parser = new XMLParser(PARSER_OPTIONS)
  let parsed: unknown
  try {
    parsed = parser.parse(xml)
  } catch {
    throw new AppError(400, 'PCCES_XML_PARSE_ERROR', '無法解析 XML，請確認為有效之 PCCES／eTender 格式')
  }

  const sheet = findEtenderSheet(parsed)
  if (!sheet) {
    throw new AppError(400, 'PCCES_XML_INVALID', '找不到 ETenderSheet 根節點')
  }

  const documentType = String(sheet['@_documentType'] ?? '').trim() || null

  const detailList = sheet.DetailList
  const detailNode = ensureArray(detailList)[0]
  if (!isRecord(detailNode)) {
    throw new AppError(400, 'PCCES_XML_INVALID', '找不到 DetailList')
  }

  const payRoot = detailNode.PayItem
  if (payRoot === undefined || payRoot === null) {
    throw new AppError(400, 'PCCES_XML_INVALID', 'DetailList 內無 PayItem')
  }

  const rows: ParsedPccesRow[] = []
  traversePayItems(payRoot, null, [], rows)

  if (rows.length === 0) {
    throw new AppError(400, 'PCCES_XML_INVALID', '未解析出任何 mainItem／general 工項')
  }

  applyPccesComputedAmounts(rows)

  rows.sort((a, b) => a.itemKey - b.itemKey)

  const keys = new Set<number>()
  for (const r of rows) {
    if (keys.has(r.itemKey)) {
      throw new AppError(400, 'PCCES_XML_INVALID', `重複的 itemKey：${r.itemKey}`)
    }
    keys.add(r.itemKey)
  }

  return { documentType, rows }
}
