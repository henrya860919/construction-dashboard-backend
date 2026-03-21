import type { Prisma, PccesItem } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { fileService } from '../file/file.service.js'
import { FILE_CATEGORY_PCCES_XML } from '../../constants/file.js'
import { prisma } from '../../lib/db.js'
import { notDeleted } from '../../shared/soft-delete.js'
import type { PccesExcelApplyBody } from '../../schemas/pcces-excel-apply.js'
import { parsePccesXmlBuffer, type ParsedPccesRow } from './pcces-xml-parser.js'
import { applyPccesComputedAmounts } from './pcces-amount-rollup.js'
import { normalizeDecimalInput } from './pcces-decimal.js'
import {
  allowsUserEnteredQtyForPccesItemKind,
  parentItemKeysWithChildren,
} from './pcces-item-tree.js'
import { pccesImportRepository } from './pcces-import.repository.js'

/** 明細頁一次載入全部工項之上限（避免超大型 XML 拖垮記憶體） */
const PCCES_ITEMS_LIST_ALL_MAX = 100_000

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

/** Excel 匯入寫入之「第 N 次變更」後綴（全形括號）；寫新備註前會先剝除 */
const PCCES_REMARK_CHANGE_ORDINAL_SUFFIX = /（第\d+次變更）\s*$/u

function stripPccesRemarkChangeOrdinal(remark: string): string {
  let s = remark.trimEnd()
  for (;;) {
    const next = s.replace(PCCES_REMARK_CHANGE_ORDINAL_SUFFIX, '').trimEnd()
    if (next === s) break
    s = next
  }
  return s
}

/** 在備註加上「（第 ordinal 次變更）」；會先移除尾端既有同格式後綴以免重疊 */
function pccesRemarkWithChangeOrdinal(remark: string, ordinal: number): string {
  const base = stripPccesRemarkChangeOrdinal(remark)
  const suffix = `（第${ordinal}次變更）`
  if (!base) return suffix
  return `${base}${suffix}`
}

function pccesDbRowToParsed(r: PccesItem): ParsedPccesRow {
  return {
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
  }
}

async function getNextPccesVersionTx(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<number> {
  const agg = await tx.pccesImport.aggregate({
    where: { projectId },
    _max: { version: true },
  })
  return (agg._max.version ?? 0) + 1
}

function serializeImport(row: {
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
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    versionLabel: row.versionLabel,
    documentType: row.documentType,
    fileName: row.fileName,
    attachmentId: row.attachmentId,
    itemCount: row.itemCount,
    generalCount: row.generalCount,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedById: row.approvedById,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
  }
}

export const pccesImportService = {
  async list(projectId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'read')
    const rows = await pccesImportRepository.listByProject(projectId)
    return rows.map(serializeImport)
  },

  async getById(projectId: string, importId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'read')
    const row = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    return serializeImport(row)
  },

  async listItems(
    projectId: string,
    importId: string,
    user: AuthUser,
    query: { page: number; limit: number; skip: number; itemKind?: string; all?: boolean }
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'read')
    const parent = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!parent) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')

    const whereKind =
      typeof query.itemKind === 'string' && query.itemKind.trim() !== ''
        ? query.itemKind.trim()
        : undefined

    const total = await pccesImportRepository.countItems(importId, whereKind)

    if (query.all) {
      if (total > PCCES_ITEMS_LIST_ALL_MAX) {
        throw new AppError(
          400,
          'PCCES_ITEMS_TOO_MANY',
          `此匯入工項超過 ${PCCES_ITEMS_LIST_ALL_MAX} 筆，無法一次載入，請聯絡管理員`
        )
      }
    }

    const skip = query.all ? 0 : query.skip
    const take = query.all ? total : query.limit

    const rows = await pccesImportRepository.listItems(importId, {
      skip,
      take,
      itemKind: whereKind,
    })

    const items = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      parentItemKey: r.parentItemKey,
      itemNo: r.itemNo,
      itemKind: r.itemKind,
      refCode: r.refCode,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      amountImported: r.amountImported,
      remark: r.remark,
      percent: r.percent,
      path: r.path,
      depth: r.depth,
    }))

    return {
      import: serializeImport(parent),
      items,
      meta: query.all
        ? { page: 1, limit: total, total }
        : { page: query.page, limit: query.limit, total },
    }
  },

  async uploadFromBuffer(
    projectId: string,
    buffer: Buffer,
    originalFileName: string,
    mimeType: string,
    user: AuthUser,
    versionLabelFromClient: string | undefined
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'create')

    const lower = originalFileName.toLowerCase()
    if (!lower.endsWith('.xml')) {
      throw new AppError(400, 'BAD_REQUEST', '請上傳 .xml 檔案')
    }

    const nextVersion = await pccesImportRepository.getNextVersion(projectId)
    const trimmed = (versionLabelFromClient ?? '').trim()
    let versionLabel: string | null
    if (nextVersion === 1) {
      versionLabel = '原契約'
    } else if (!trimmed) {
      throw new AppError(400, 'BAD_REQUEST', '請填寫版本名稱')
    } else {
      versionLabel = trimmed
    }

    const { documentType, rows } = await parsePccesXmlBuffer(buffer)

    const created = await pccesImportRepository.createImportWithItems(
      projectId,
      user.id,
      originalFileName,
      documentType,
      rows,
      null,
      versionLabel
    )

    try {
      const att = await fileService.uploadFile(
        buffer,
        originalFileName,
        mimeType || 'application/xml',
        projectId,
        user.id,
        user,
        { category: FILE_CATEGORY_PCCES_XML, businessId: created.id }
      )
      await pccesImportRepository.updateAttachmentId(created.id, att.id)
    } catch {
      // 歸檔失敗不阻擋匯入；attachmentId 維持 null
    }

    const withAtt = await pccesImportRepository.findByIdForProject(projectId, created.id)
    return serializeImport(withAtt ?? created)
  },

  async patchVersionLabel(
    projectId: string,
    importId: string,
    user: AuthUser,
    versionLabel: string
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'update')
    const row = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    const t = versionLabel.trim()
    const next: string | null = t === '' ? null : t
    const ok = await pccesImportRepository.updateVersionLabel(projectId, importId, next)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    const updated = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!updated) throw new AppError(500, 'INTERNAL_ERROR', '更新後讀取失敗')
    return serializeImport(updated)
  },

  async approve(projectId: string, importId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'update')
    const ok = await pccesImportRepository.approveImport(projectId, importId, user.id)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    const row = await pccesImportRepository.findByIdForProject(projectId, importId)
    if (!row) throw new AppError(500, 'INTERNAL_ERROR', '核定後讀取失敗')
    return serializeImport(row)
  },

  async softDelete(projectId: string, importId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'delete')
    const result = await pccesImportRepository.softDeleteImport(projectId, importId, user.id)
    if (!result) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')
    if (result.attachmentId) {
      try {
        await fileService.delete(result.attachmentId, user.id, user)
      } catch {
        // 匯入與工項已軟刪；歸檔檔刪除失敗不阻擋（避免 R2／競態導致整體失敗）
      }
    }
  },

  /**
   * 以某版匯入為基底複製工項，套用 Excel 對應結果後產生新版本（未自動核定）。
   * URL 之 importId 為「基底版」id；寫入之變更紀錄與新工項皆屬於新產生之 import。
   */
  async applyExcelChanges(
    projectId: string,
    baseImportId: string,
    user: AuthUser,
    body: PccesExcelApplyBody
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', 'create')

    if (body.autoMatched.length === 0 && body.manuallyPlaced.length === 0) {
      throw new AppError(400, 'BAD_REQUEST', '沒有可匯入的變更項目')
    }

    const baseParent = await pccesImportRepository.findByIdForProject(projectId, baseImportId)
    if (!baseParent) throw new AppError(404, 'NOT_FOUND', '找不到該次匯入')

    const baseItems = await prisma.pccesItem.findMany({
      where: { importId: baseImportId, ...notDeleted },
      orderBy: { itemKey: 'asc' },
    })
    if (baseItems.length === 0) {
      throw new AppError(400, 'BAD_REQUEST', '基底匯入沒有工項可複製')
    }

    const parentsWithChildren = parentItemKeysWithChildren(
      baseItems.map((r) => ({ parentItemKey: r.parentItemKey }))
    )
    const leafKeys = new Set(
      baseItems.filter((r) => !parentsWithChildren.has(r.itemKey)).map((r) => r.itemKey)
    )
    const itemByKey = new Map(baseItems.map((r) => [r.itemKey, r]))

    const seenAuto = new Set<number>()
    for (const a of body.autoMatched) {
      if (seenAuto.has(a.itemKey)) {
        throw new AppError(400, 'BAD_REQUEST', `重複的 itemKey：${a.itemKey}`)
      }
      seenAuto.add(a.itemKey)
      const baseItem = itemByKey.get(a.itemKey)
      if (!baseItem) {
        throw new AppError(400, 'BAD_REQUEST', `找不到 itemKey ${a.itemKey}`)
      }
      if (!leafKeys.has(a.itemKey)) {
        throw new AppError(400, 'BAD_REQUEST', `僅能變更葉節點工項（itemKey ${a.itemKey}）`)
      }
      if (a.newQuantity?.trim() && !allowsUserEnteredQtyForPccesItemKind(baseItem.itemKind)) {
        throw new AppError(
          400,
          'PCCES_QTY_KIND',
          `工項「${baseItem.description.slice(0, 40)}…」類型不允許變更數量`
        )
      }
    }

    for (const m of body.manuallyPlaced) {
      const p = itemByKey.get(m.parentItemKey)
      if (!p || p.itemKind !== 'mainItem') {
        throw new AppError(400, 'BAD_REQUEST', '指定父層必須為 mainItem 工項')
      }
    }

    const fileName = body.fileName?.trim() || 'pcces-changes.xlsx'
    const newVersionLabel = body.versionLabel.trim()

    const newImportId = await prisma.$transaction(async (tx) => {
      const version = await getNextPccesVersionTx(tx, projectId)

      const priorChangeRows = await tx.pccesItemChange.findMany({
        where: {
          ...notDeleted,
          import: {
            projectId,
            ...notDeleted,
            documentType: 'excel_change',
            version: { lt: version },
          },
          pccesItem: notDeleted,
        },
        select: {
          pccesItem: { select: { itemKey: true } },
        },
      })
      const priorChangeCountByItemKey = new Map<number, number>()
      for (const row of priorChangeRows) {
        const k = row.pccesItem.itemKey
        priorChangeCountByItemKey.set(k, (priorChangeCountByItemKey.get(k) ?? 0) + 1)
      }

      const newImp = await tx.pccesImport.create({
        data: {
          projectId,
          version,
          versionLabel: newVersionLabel,
          documentType: 'excel_change',
          fileName,
          attachmentId: null,
          itemCount: 0,
          generalCount: 0,
          createdById: user.id,
        },
      })

      const chunk = 400
      for (let i = 0; i < baseItems.length; i += chunk) {
        const slice = baseItems.slice(i, i + chunk)
        await tx.pccesItem.createMany({
          data: slice.map((r) => ({
            importId: newImp.id,
            itemKey: r.itemKey,
            parentItemKey: r.parentItemKey,
            itemNo: r.itemNo,
            itemKind: r.itemKind,
            refCode: r.refCode,
            description: r.description,
            unit: r.unit,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            amountImported: r.amountImported,
            remark: r.remark,
            percent: r.percent,
            path: r.path,
            depth: r.depth,
          })),
        })
      }

      const newRows = await tx.pccesItem.findMany({
        where: { importId: newImp.id, ...notDeleted },
        select: {
          id: true,
          itemKey: true,
          quantity: true,
          unitPrice: true,
        },
      })
      const newIdByKey = new Map(newRows.map((r) => [r.itemKey, r]))

      for (const a of body.autoMatched) {
        const row = newIdByKey.get(a.itemKey)
        if (!row) {
          throw new AppError(500, 'INTERNAL_ERROR', '複製工項後對應失敗')
        }
        const prevQ = row.quantity.toString()
        const prevP = row.unitPrice.toString()
        let nextQ = prevQ
        let nextP = prevP
        if (a.newQuantity?.trim()) {
          nextQ = normalizeDecimalInput(a.newQuantity, '變更後數量')
        }
        if (a.newUnitPrice?.trim()) {
          nextP = normalizeDecimalInput(a.newUnitPrice, '新增單價')
        }

        const baseRow = itemByKey.get(a.itemKey)
        const priorN = priorChangeCountByItemKey.get(a.itemKey) ?? 0
        const changeOrdinal = priorN + 1
        const nextRemark = pccesRemarkWithChangeOrdinal(baseRow?.remark ?? '', changeOrdinal)

        await tx.pccesItem.update({
          where: { id: row.id },
          data: { quantity: nextQ, unitPrice: nextP, remark: nextRemark },
        })

        await tx.pccesItemChange.create({
          data: {
            importId: newImp.id,
            pccesItemId: row.id,
            kind: 'auto_matched',
            excelItemNo: a.excel.itemNo ?? null,
            excelDescription: a.excel.description,
            excelUnit: a.excel.unit ?? null,
            excelQty: a.excel.qtyRaw ?? null,
            excelUnitPrice: a.excel.unitPriceRaw ?? null,
            excelRemark: a.excel.remark ?? null,
            prevQuantity: prevQ,
            prevUnitPrice: prevP,
            newQuantity: nextQ,
            newUnitPrice: nextP,
            parentItemKey: null,
            createdById: user.id,
          },
        })
      }

      let nextItemKey = Math.max(0, ...baseItems.map((r) => r.itemKey))

      for (const m of body.manuallyPlaced) {
        nextItemKey += 1
        const parent = await tx.pccesItem.findFirst({
          where: { importId: newImp.id, itemKey: m.parentItemKey, ...notDeleted },
        })
        if (!parent || parent.itemKind !== 'mainItem') {
          throw new AppError(500, 'INTERNAL_ERROR', '父層工項不存在')
        }

        const qty = normalizeDecimalInput(m.quantity, '變更後數量')
        const price = normalizeDecimalInput(m.unitPrice, '新增單價')
        const pathStr = `${parent.path} > ${m.itemNo} ${m.description}`.trim()

        const placedRemark = pccesRemarkWithChangeOrdinal(m.remark ?? '', 1)

        const created = await tx.pccesItem.create({
          data: {
            importId: newImp.id,
            itemKey: nextItemKey,
            parentItemKey: m.parentItemKey,
            itemNo: m.itemNo,
            itemKind: 'general',
            refCode: '',
            description: m.description,
            unit: m.unit,
            quantity: qty,
            unitPrice: price,
            amountImported: null,
            remark: placedRemark,
            percent: null,
            path: pathStr,
            depth: parent.depth + 1,
          },
        })

        await tx.pccesItemChange.create({
          data: {
            importId: newImp.id,
            pccesItemId: created.id,
            kind: 'manually_placed',
            excelItemNo: m.excel.itemNo ?? null,
            excelDescription: m.excel.description,
            excelUnit: m.excel.unit ?? null,
            excelQty: m.excel.qtyRaw ?? null,
            excelUnitPrice: m.excel.unitPriceRaw ?? null,
            excelRemark: m.excel.remark ?? null,
            prevQuantity: null,
            prevUnitPrice: null,
            newQuantity: qty,
            newUnitPrice: price,
            parentItemKey: m.parentItemKey,
            createdById: user.id,
          },
        })
      }

      const allAfter = await tx.pccesItem.findMany({
        where: { importId: newImp.id, ...notDeleted },
        orderBy: { itemKey: 'asc' },
      })
      const parsed = allAfter.map((r) => pccesDbRowToParsed(r))
      applyPccesComputedAmounts(parsed)
      for (const r of parsed) {
        await tx.pccesItem.update({
          where: {
            importId_itemKey: { importId: newImp.id, itemKey: r.itemKey },
          },
          data: {
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            amountImported: r.amountImported ?? null,
          },
        })
      }

      const pw = parentItemKeysWithChildren(
        allAfter.map((r) => ({ parentItemKey: r.parentItemKey }))
      )
      const generalCount = allAfter.filter((r) => !pw.has(r.itemKey)).length
      await tx.pccesImport.update({
        where: { id: newImp.id },
        data: { itemCount: allAfter.length, generalCount },
      })

      return newImp.id
    })

    const row = await pccesImportRepository.findByIdForProject(projectId, newImportId)
    if (!row) throw new AppError(500, 'INTERNAL_ERROR', '匯入完成後讀取失敗')
    return serializeImport(row)
  },
}
