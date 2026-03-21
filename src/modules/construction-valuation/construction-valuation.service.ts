import { Prisma } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { prisma } from '../../lib/db.js'
import { notDeleted } from '../../shared/soft-delete.js'
import type { ConstructionValuationCreateInput } from '../../schemas/construction-valuation.js'
import {
  constructionValuationCreateSchema,
  constructionValuationUpdateSchema,
} from '../../schemas/construction-valuation.js'
import { pccesImportRepository } from '../pcces-import/pcces-import.repository.js'
import {
  allowsUserEnteredQtyForPccesItemKind,
  isStructuralLeaf,
  parentItemKeysWithChildren,
} from '../pcces-import/pcces-item-tree.js'
import { constructionDailyLogRepository } from '../construction-daily-log/construction-daily-log.repository.js'
import { constructionValuationRepository } from './construction-valuation.repository.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

function formatDateOnlyUtc(d: Date | null): string | null {
  if (!d) return null
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 估驗「截至」日：有表頭日期用該日（UTC 日界）；否則用今天 UTC。 */
function asOfDateUtcForValuation(valuationDateIso: string | null | undefined): Date {
  const t = valuationDateIso?.trim()
  if (t) {
    const [y, m, d] = t.split('-').map(Number)
    if (y && m && d) return new Date(Date.UTC(y, m - 1, d))
  }
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
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

function lineCap(
  contractQty: Prisma.Decimal,
  approvedQtyAfterChange: Prisma.Decimal | null
): Prisma.Decimal {
  if (approvedQtyAfterChange != null && !approvedQtyAfterChange.isNaN()) {
    return approvedQtyAfterChange
  }
  return contractQty
}

function serializeLineComputed(params: {
  priorBilledQty: Prisma.Decimal
  contractQty: Prisma.Decimal
  approvedQtyAfterChange: Prisma.Decimal | null
  unitPrice: Prisma.Decimal
  currentPeriodQty: Prisma.Decimal
  itemNo: string
  description: string
  unit: string
  remark: string
  pccesItemId: string | null
  /** 綁定 PCCES 時之 XML itemKind；手填列為 null */
  pccesItemKind: string | null
  lineId: string
  /** PCCES 列：施工日誌截至估驗日之累計完成量；手填列為 null（不限制） */
  logAccumulatedQtyToDate: Prisma.Decimal | null
}) {
  const cap = lineCap(params.contractQty, params.approvedQtyAfterChange)
  const current = params.currentPeriodQty
  const prior = params.priorBilledQty
  const cumulative = prior.plus(current)
  const effectiveCap =
    params.pccesItemId != null && params.logAccumulatedQtyToDate != null
      ? Prisma.Decimal.min(cap, params.logAccumulatedQtyToDate)
      : cap
  const available = effectiveCap.minus(prior).minus(current)
  const availStr = available.isNeg() ? '0' : available.toString()
  return {
    id: params.lineId,
    pccesItemId: params.pccesItemId,
    pccesItemKind: params.pccesItemKind,
    itemNo: params.itemNo,
    description: params.description,
    unit: params.unit,
    contractQty: params.contractQty.toString(),
    approvedQtyAfterChange: serializeDecimal(params.approvedQtyAfterChange),
    unitPrice: params.unitPrice.toString(),
    currentPeriodQty: current.toString(),
    remark: params.remark,
    priorBilledQty: prior.toString(),
    maxQty: cap.toString(),
    logAccumulatedQtyToDate:
      params.pccesItemId != null && params.logAccumulatedQtyToDate != null
        ? params.logAccumulatedQtyToDate.toString()
        : null,
    /** 本次可估驗數量：min(契約上限,日誌累計)−已請款−本次填寫；與本次估驗數量連動 */
    availableValuationQty: availStr,
    cumulativeValuationQtyToDate: cumulative.toString(),
    currentPeriodAmount: current.mul(params.unitPrice).toString(),
    cumulativeAmountToDate: cumulative.mul(params.unitPrice).toString(),
  }
}

type ValuationLineRow = NonNullable<
  Awaited<ReturnType<typeof constructionValuationRepository.findByIdForProject>>
>['lines'][0]

type SerializedValuationLine = ReturnType<typeof serializeLineComputed> & {
  pccesParentItemKey: number | null
}

function serializeLineWithParentKey(
  l: ValuationLineRow,
  prior: Prisma.Decimal,
  logByPccesId: Map<string, Prisma.Decimal>
): SerializedValuationLine {
  const logQty =
    l.pccesItemId != null ? (logByPccesId.get(l.pccesItemId) ?? new Prisma.Decimal(0)) : null
  const base = serializeLineComputed({
    lineId: l.id,
    pccesItemId: l.pccesItemId,
    pccesItemKind: l.pccesItem?.itemKind ?? null,
    itemNo: l.pccesItem?.itemNo ?? l.itemNo,
    description: l.description,
    unit: l.unit,
    contractQty: l.contractQty,
    approvedQtyAfterChange: l.approvedQtyAfterChange,
    unitPrice: l.unitPrice,
    currentPeriodQty: l.currentPeriodQty,
    remark: l.remark,
    priorBilledQty: prior,
    logAccumulatedQtyToDate: logQty,
  })
  return {
    ...base,
    pccesParentItemKey: l.pccesItem?.parentItemKey ?? null,
  }
}

async function buildOrderedLinesAndGroups(
  row: NonNullable<Awaited<ReturnType<typeof constructionValuationRepository.findByIdForProject>>>,
  priorByPccesId: Map<string, Prisma.Decimal>,
  logByPccesId: Map<string, Prisma.Decimal>
): Promise<{
  lines: SerializedValuationLine[]
  lineGroups: {
    parent: {
      itemNo: string
      description: string
      unit: string
      currentPeriodAmountSum: string
      cumulativeAmountToDateSum: string
    } | null
    lineStartIndex: number
    lineCount: number
  }[]
}> {
  type Entry = { sortOrder: number; serialized: SerializedValuationLine; raw: ValuationLineRow }

  const entries: Entry[] = row.lines.map((l) => {
    const prior =
      l.pccesItemId != null
        ? (priorByPccesId.get(l.pccesItemId) ?? new Prisma.Decimal(0))
        : new Prisma.Decimal(0)
    return {
      sortOrder: l.sortOrder,
      serialized: serializeLineWithParentKey(l, prior, logByPccesId),
      raw: l,
    }
  })

  const manual = entries.filter((e) => !e.raw.pccesItemId).sort((a, b) => a.sortOrder - b.sortOrder)
  const pcces = entries.filter((e) => e.raw.pccesItemId)

  if (pcces.length === 0) {
    const lines = manual.map((e) => e.serialized)
    const lineGroups =
      manual.length > 0 ? [{ parent: null as null, lineStartIndex: 0, lineCount: manual.length }] : []
    return { lines, lineGroups }
  }

  const importIds = new Set(
    pcces.map((e) => e.raw.pccesItem!.importId).filter((id): id is string => Boolean(id))
  )
  if (importIds.size !== 1) {
    const all = [...entries].sort((a, b) => a.sortOrder - b.sortOrder)
    const lines = all.map((e) => e.serialized)
    return {
      lines,
      lineGroups: [{ parent: null, lineStartIndex: 0, lineCount: lines.length }],
    }
  }

  const importId = [...importIds][0]!
  const allItems = await prisma.pccesItem.findMany({
    where: { importId, ...notDeleted },
    select: {
      itemKey: true,
      itemKind: true,
      itemNo: true,
      description: true,
      unit: true,
    },
  })
  const byKey = new Map(allItems.map((i) => [i.itemKey, i]))

  const parentBuckets = new Map<number, Entry[]>()
  const orphanPcces: Entry[] = []

  for (const e of pcces) {
    const pk = e.raw.pccesItem?.parentItemKey
    if (pk != null) {
      const parent = byKey.get(pk)
      if (parent != null) {
        const list = parentBuckets.get(pk) ?? []
        list.push(e)
        parentBuckets.set(pk, list)
        continue
      }
    }
    orphanPcces.push(e)
  }

  const sortedPks = [...parentBuckets.keys()].sort((a, b) => a - b)
  orphanPcces.sort((a, b) => a.sortOrder - b.sortOrder)

  const ordered: SerializedValuationLine[] = []
  const lineGroups: {
    parent: {
      itemNo: string
      description: string
      unit: string
      currentPeriodAmountSum: string
      cumulativeAmountToDateSum: string
    } | null
    lineStartIndex: number
    lineCount: number
  }[] = []

  for (const pk of sortedPks) {
    const arr = (parentBuckets.get(pk) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
    if (arr.length === 0) continue
    const parentRow = byKey.get(pk)
    if (!parentRow) continue
    const start = ordered.length
    let sum6 = new Prisma.Decimal(0)
    let sum7 = new Prisma.Decimal(0)
    for (const e of arr) {
      ordered.push(e.serialized)
      sum6 = sum6.plus(decQty(e.serialized.currentPeriodAmount))
      sum7 = sum7.plus(decQty(e.serialized.cumulativeAmountToDate))
    }
    lineGroups.push({
      parent: {
        itemNo: parentRow.itemNo,
        description: parentRow.description,
        unit: parentRow.unit,
        currentPeriodAmountSum: sum6.toString(),
        cumulativeAmountToDateSum: sum7.toString(),
      },
      lineStartIndex: start,
      lineCount: arr.length,
    })
  }

  if (orphanPcces.length > 0) {
    const start = ordered.length
    for (const e of orphanPcces) {
      ordered.push(e.serialized)
    }
    lineGroups.push({
      parent: null,
      lineStartIndex: start,
      lineCount: orphanPcces.length,
    })
  }

  if (manual.length > 0) {
    const start = ordered.length
    for (const e of manual) {
      ordered.push(e.serialized)
    }
    lineGroups.push({
      parent: null,
      lineStartIndex: start,
      lineCount: manual.length,
    })
  }

  return { lines: ordered, lineGroups }
}

async function normalizeValuationBody(
  projectId: string,
  excludeValuationId: string | undefined,
  body: ConstructionValuationCreateInput
): Promise<ConstructionValuationCreateInput> {
  const seen = new Set<string>()
  for (const line of body.lines) {
    if (line.pccesItemId) {
      if (seen.has(line.pccesItemId)) {
        throw new AppError(400, 'VALIDATION_ERROR', '同一估驗單不可重複綁定相同 PCCES 工項')
      }
      seen.add(line.pccesItemId)
    }
  }

  const pccesIds = body.lines
    .map((l) => l.pccesItemId)
    .filter((id): id is string => Boolean(id))

  const latest = await pccesImportRepository.findLatestApprovedImport(projectId)

  let priorMap = new Map<string, Prisma.Decimal>()
  let logAccumMap = new Map<string, Prisma.Decimal>()
  if (pccesIds.length > 0) {
    if (!latest) {
      throw new AppError(400, 'PCCES_NOT_APPROVED', '專案尚無核定之 PCCES 版本，無法綁定工項')
    }
    priorMap = await constructionValuationRepository.sumCurrentPeriodQtyByPccesItemsExcludingValuation(
      projectId,
      pccesIds,
      excludeValuationId
    )
    const asOf = asOfDateUtcForValuation(body.valuationDate ?? null)
    logAccumMap = await constructionDailyLogRepository.sumDailyQtyByPccesItemsThroughDateInclusive(
      projectId,
      pccesIds,
      asOf
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

  const nextLines: ConstructionValuationCreateInput['lines'] = []

  for (const line of body.lines) {
    const current = decQty(line.currentPeriodQty)
    if (current.isNeg()) {
      throw new AppError(400, 'VALIDATION_ERROR', '本次估驗數量不可為負')
    }

    if (!line.pccesItemId) {
      const contract = decQty(line.contractQty)
      const cap = lineCap(contract, line.approvedQtyAfterChange ? decQty(line.approvedQtyAfterChange) : null)
      if (current.gt(cap)) {
        throw new AppError(400, 'VALUATION_QTY_EXCEEDED', '本次估驗數量不可超過契約／變更後核定上限')
      }
      nextLines.push({
        ...line,
        pccesItemId: undefined,
        contractQty: contract.toString(),
        approvedQtyAfterChange: line.approvedQtyAfterChange,
        unitPrice: decQty(line.unitPrice).toString(),
        currentPeriodQty: current.toString(),
      })
      continue
    }

    const item = itemById.get(line.pccesItemId)
    if (!item || !isStructuralLeaf(item, parentsWithChildren)) {
      throw new AppError(
        400,
        'BAD_REQUEST',
        'PCCES 工項無效、非末層或不在目前核定版本中'
      )
    }

    if (!allowsUserEnteredQtyForPccesItemKind(item.itemKind) && !current.isZero()) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        '此 PCCES 類型僅能填寫本次估驗數量為 0'
      )
    }

    const contract = item.quantity
    const approvedSnap = line.approvedQtyAfterChange ? decQty(line.approvedQtyAfterChange) : null
    const cap = lineCap(contract, approvedSnap)
    const prior = priorMap.get(line.pccesItemId) ?? new Prisma.Decimal(0)
    const logQty = logAccumMap.get(line.pccesItemId) ?? new Prisma.Decimal(0)
    const effectiveCap = Prisma.Decimal.min(cap, logQty)
    if (prior.plus(current).gt(effectiveCap)) {
      throw new AppError(
        400,
        'VALUATION_QTY_EXCEEDED',
        '本次估驗後累計不可超過施工日誌累計完成量（並受契約／變更後核定上限）'
      )
    }

    nextLines.push({
      pccesItemId: item.id,
      itemNo: item.itemNo,
      description: item.description,
      unit: item.unit,
      contractQty: contract.toString(),
      approvedQtyAfterChange: approvedSnap ? approvedSnap.toString() : null,
      unitPrice: item.unitPrice.toString(),
      currentPeriodQty: current.toString(),
      remark: line.remark,
    })
  }

  return { ...body, lines: nextLines }
}

function serializeListRow(
  row: Awaited<ReturnType<typeof constructionValuationRepository.listByProject>>['rows'][0]
) {
  let total = new Prisma.Decimal(0)
  for (const l of row.lines) {
    total = total.plus(l.currentPeriodQty.mul(l.unitPrice))
  }
  return {
    id: row.id,
    title: row.title,
    valuationDate: formatDateOnlyUtc(row.valuationDate),
    headerRemark: row.headerRemark,
    currentPeriodTotalAmount: total.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function serializeDetail(
  row: NonNullable<Awaited<ReturnType<typeof constructionValuationRepository.findByIdForProject>>>,
  priorByPccesId: Map<string, Prisma.Decimal>,
  logByPccesId: Map<string, Prisma.Decimal>
) {
  const { lines, lineGroups } = await buildOrderedLinesAndGroups(row, priorByPccesId, logByPccesId)
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    valuationDate: formatDateOnlyUtc(row.valuationDate),
    headerRemark: row.headerRemark,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines,
    lineGroups,
  }
}

async function loadValuationDetail(projectId: string, valuationId: string, user: AuthUser) {
  await assertProjectModuleAction(user, projectId, 'construction.valuation', 'read')
  const row = await constructionValuationRepository.findByIdForProject(projectId, valuationId)
  if (!row) throw new AppError(404, 'NOT_FOUND', '找不到估驗計價')
  const pccesIds = row.lines.map((l) => l.pccesItemId).filter((id): id is string => Boolean(id))
  const priorMap =
    pccesIds.length === 0
      ? new Map<string, Prisma.Decimal>()
      : await constructionValuationRepository.sumCurrentPeriodQtyByPccesItemsExcludingValuation(
          projectId,
          pccesIds,
          valuationId
        )
  const asOf = asOfDateUtcForValuation(formatDateOnlyUtc(row.valuationDate))
  const logMap =
    pccesIds.length === 0
      ? new Map<string, Prisma.Decimal>()
      : await constructionDailyLogRepository.sumDailyQtyByPccesItemsThroughDateInclusive(
          projectId,
          pccesIds,
          asOf
        )
  return await serializeDetail(row, priorMap, logMap)
}

export const constructionValuationService = {
  async list(projectId: string, user: AuthUser, page: number, limit: number) {
    await assertProjectModuleAction(user, projectId, 'construction.valuation', 'read')
    const skip = (page - 1) * limit
    const { rows, total } = await constructionValuationRepository.listByProject(projectId, {
      skip,
      take: limit,
    })
    return {
      data: rows.map(serializeListRow),
      meta: { page, limit, total },
    }
  },

  async getById(projectId: string, valuationId: string, user: AuthUser) {
    return loadValuationDetail(projectId, valuationId, user)
  },

  async create(projectId: string, user: AuthUser, raw: unknown) {
    await assertProjectModuleAction(user, projectId, 'construction.valuation', 'create')
    const parsed = constructionValuationCreateSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', '資料驗證失敗')
    }
    const normalized = await normalizeValuationBody(projectId, undefined, parsed.data)
    const id = await constructionValuationRepository.create(projectId, user.id, normalized)
    return loadValuationDetail(projectId, id, user)
  },

  async update(projectId: string, valuationId: string, user: AuthUser, raw: unknown) {
    await assertProjectModuleAction(user, projectId, 'construction.valuation', 'update')
    const parsed = constructionValuationUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', '資料驗證失敗')
    }
    const normalized = await normalizeValuationBody(projectId, valuationId, parsed.data)
    const ok = await constructionValuationRepository.update(projectId, valuationId, normalized)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到估驗計價')
    return loadValuationDetail(projectId, valuationId, user)
  },

  async delete(projectId: string, valuationId: string, user: AuthUser) {
    await assertProjectModuleAction(user, projectId, 'construction.valuation', 'delete')
    const ok = await constructionValuationRepository.softDelete(projectId, valuationId, user.id)
    if (!ok) throw new AppError(404, 'NOT_FOUND', '找不到估驗計價')
    return { ok: true as const }
  },

  /**
   * 估驗計價用：最新核定版**全部**工項於 `rows`，與「PCCES 明細／全部類型」相同 **itemKey 升序**；
   * 父列與末層欄位一致；`isStructuralLeaf` 為 true 者帶估驗／日誌聚合欄位。
   */
  async getPccesLinePicker(
    projectId: string,
    user: AuthUser,
    excludeValuationId?: string,
    /** YYYY-MM-DD；省略則截至今日 UTC */
    asOfDateIso?: string | null
  ) {
    await assertProjectModuleAction(user, projectId, 'construction.valuation', 'read')
    const latest = await pccesImportRepository.findLatestApprovedImport(projectId)
    type RowOut = {
      pccesItemId: string
      itemKey: number
      parentItemKey: number | null
      itemNo: string
      description: string
      unit: string
      itemKind: string
      contractQty: string
      approvedQtyAfterChange: string | null
      unitPrice: string
      isStructuralLeaf: boolean
      priorBilledQty: string | null
      maxQty: string | null
      logAccumulatedQtyToDate: string | null
      suggestedAvailableQty: string | null
    }
    type GroupOut = {
      parent: { itemNo: string; description: string; unit: string; itemKey: number } | null
      children: RowOut[]
    }
    if (!latest) {
      return {
        pccesImport: null as null,
        rows: [] as RowOut[],
        groups: [] as GroupOut[],
        items: [] as RowOut[],
      }
    }

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
    const parentsWithChildren = parentItemKeysWithChildren(allItems)
    const leafIds = new Set(
      allItems.filter((i) => isStructuralLeaf(i, parentsWithChildren)).map((i) => i.id)
    )
    const leafIdList = [...leafIds]

    const priorMap =
      leafIdList.length === 0
        ? new Map<string, Prisma.Decimal>()
        : await constructionValuationRepository.sumCurrentPeriodQtyByPccesItemsExcludingValuation(
            projectId,
            leafIdList,
            excludeValuationId
          )

    const pickerAsOf = asOfDateUtcForValuation(
      asOfDateIso && asOfDateIso.trim() !== '' ? asOfDateIso : undefined
    )
    const logMap =
      leafIdList.length === 0
        ? new Map<string, Prisma.Decimal>()
        : await constructionDailyLogRepository.sumDailyQtyByPccesItemsThroughDateInclusive(
            projectId,
            leafIdList,
            pickerAsOf
          )

    const rows: RowOut[] = allItems.map((r) => {
      const isLeaf = leafIds.has(r.id)
      const cap = r.quantity
      if (!isLeaf) {
        return {
          pccesItemId: r.id,
          itemKey: r.itemKey,
          parentItemKey: r.parentItemKey,
          itemNo: r.itemNo,
          description: r.description,
          unit: r.unit,
          itemKind: r.itemKind,
          contractQty: r.quantity.toString(),
          approvedQtyAfterChange: null as string | null,
          unitPrice: r.unitPrice.toString(),
          isStructuralLeaf: false,
          priorBilledQty: null,
          maxQty: null,
          logAccumulatedQtyToDate: null,
          suggestedAvailableQty: null,
        }
      }
      const prior = priorMap.get(r.id) ?? new Prisma.Decimal(0)
      const logQty = logMap.get(r.id) ?? new Prisma.Decimal(0)
      const effectiveCap = Prisma.Decimal.min(cap, logQty)
      const avail = effectiveCap.minus(prior)
      return {
        pccesItemId: r.id,
        itemKey: r.itemKey,
        parentItemKey: r.parentItemKey,
        itemNo: r.itemNo,
        description: r.description,
        unit: r.unit,
        itemKind: r.itemKind,
        contractQty: r.quantity.toString(),
        approvedQtyAfterChange: null as string | null,
        unitPrice: r.unitPrice.toString(),
        isStructuralLeaf: true,
        priorBilledQty: prior.toString(),
        maxQty: cap.toString(),
        logAccumulatedQtyToDate: logQty.toString(),
        suggestedAvailableQty: (avail.isNeg() ? new Prisma.Decimal(0) : avail).toString(),
      }
    })

    const items = rows.filter((x) => x.isStructuralLeaf)

    const importMeta = await pccesImportRepository.findByIdForProject(projectId, latest.id)
    return {
      pccesImport: importMeta
        ? {
            id: importMeta.id,
            version: importMeta.version,
            approvedAt: importMeta.approvedAt?.toISOString() ?? null,
            approvedById: importMeta.approvedById,
          }
        : {
            id: latest.id,
            version: latest.version,
            approvedAt: null as string | null,
            approvedById: null as string | null,
          },
      rows,
      groups: [] as GroupOut[],
      items,
    }
  },
}
