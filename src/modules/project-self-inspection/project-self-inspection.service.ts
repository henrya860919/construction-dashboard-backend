import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import {
  selfInspectionTemplateRepository,
  selfInspectionBlockRepository,
  type SelfInspectionBlockWithItems,
} from '../self-inspection-template/self-inspection-template.repository.js'
import { mergeHeaderConfig, type HeaderConfig } from '../../schemas/self-inspection-template.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import type { FilledPayloadInput } from '../../schemas/self-inspection-record.js'
import {
  projectSelfInspectionRepository,
  projectSelfInspectionLinkRepository,
  type SelfInspectionRecordRow,
  type SelfInspectionRecordListRow,
} from './project-self-inspection.repository.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensureInspection(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'delete'
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'construction.inspection', action)
}

async function getProjectTenantId(projectId: string): Promise<string> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    select: { tenantId: true },
  })
  if (!p) {
    throw new AppError(404, 'NOT_FOUND', '找不到該專案')
  }
  if (p.tenantId == null || p.tenantId === '') {
    throw new AppError(400, 'BAD_REQUEST', '專案未綁定租戶，無法使用自主查驗')
  }
  return p.tenantId
}

async function loadTemplateInTenant(templateId: string, tenantId: string) {
  const t = await selfInspectionTemplateRepository.findById(templateId)
  if (!t || t.tenantId !== tenantId) {
    throw new AppError(404, 'NOT_FOUND', '找不到該自主檢查樣板或與專案租戶不符')
  }
  return t
}

async function ensureTemplateLinkedToProject(projectId: string, templateId: string) {
  const linked = await projectSelfInspectionLinkRepository.exists(projectId, templateId)
  if (!linked) {
    throw new AppError(404, 'NOT_FOUND', '此樣板未匯入至本專案')
  }
}

function assertTemplateActiveForCreate(t: { status: string }) {
  if (t.status !== 'active') {
    throw new AppError(400, 'BAD_REQUEST', '此樣板已封存，無法新增查驗紀錄')
  }
}

function collectItemIds(blocks: SelfInspectionBlockWithItems[]): Set<string> {
  const s = new Set<string>()
  for (const b of blocks) {
    for (const it of b.items) {
      s.add(it.id)
    }
  }
  return s
}

function validateFilledPayload(header: HeaderConfig, blocks: SelfInspectionBlockWithItems[], payload: FilledPayloadInput) {
  const validItemIds = collectItemIds(blocks)
  const timingIds = new Set(header.timingOptions.map((o) => o.id))
  const resultIds = new Set(header.resultLegendOptions.map((o) => o.id))

  const h = payload.header
  if (h?.timingOptionId != null && h.timingOptionId !== '') {
    if (!timingIds.has(h.timingOptionId)) {
      throw new AppError(400, 'VALIDATION_ERROR', '檢查時機選項無效')
    }
  }

  const items = payload.items
  if (items == null) return
  for (const itemId of Object.keys(items)) {
    if (!validItemIds.has(itemId)) {
      throw new AppError(400, 'VALIDATION_ERROR', `查驗列 id 無效：${itemId}`)
    }
    const row = items[itemId]
    const rid = row?.resultOptionId
    if (rid != null && rid !== '' && !resultIds.has(rid)) {
      throw new AppError(400, 'VALIDATION_ERROR', '檢查結果選項無效')
    }
  }
}

function toBlockWithItemsDto(row: SelfInspectionBlockWithItems) {
  return {
    id: row.id,
    templateId: row.templateId,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map((it) => ({
      id: it.id,
      blockId: it.blockId,
      categoryLabel: it.categoryLabel,
      itemName: it.itemName,
      standardText: it.standardText,
      sortOrder: it.sortOrder,
      createdAt: it.createdAt.toISOString(),
      updatedAt: it.updatedAt.toISOString(),
    })),
  }
}

function toTemplateDetailDto(row: Awaited<ReturnType<typeof selfInspectionTemplateRepository.findById>>) {
  if (!row) throw new Error('template row required')
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    status: row.status,
    headerConfig: mergeHeaderConfig(row.headerConfig) as HeaderConfig,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toRecordListDto(row: SelfInspectionRecordListRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    templateId: row.templateId,
    filledPayload: row.filledPayload,
    filledById: row.filledById,
    filledBy: row.filledBy
      ? { id: row.filledBy.id, name: row.filledBy.name, email: row.filledBy.email }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toRecordDetailDto(row: SelfInspectionRecordRow) {
  return {
    ...toRecordListDto(row),
    structureSnapshot: row.structureSnapshot,
  }
}

/** 寫入紀錄時一併保存，供詳情顯示（與 GET template hub 相同語意，不含即時 recordCount） */
function buildStructureSnapshotJson(
  templateRow: NonNullable<Awaited<ReturnType<typeof selfInspectionTemplateRepository.findById>>>,
  blocks: SelfInspectionBlockWithItems[]
) {
  return {
    template: toTemplateDetailDto(templateRow),
    blocks: blocks.map(toBlockWithItemsDto),
    recordCount: 0,
  } as const
}

export const projectSelfInspectionService = {
  /** 已匯入本專案之樣板（含查驗次數、匯入時間） */
  async listTemplates(projectId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'read')
    const tenantId = await getProjectTenantId(projectId)
    const links = await projectSelfInspectionLinkRepository.findLinksWithTemplates(projectId)
    const filtered = links.filter((l) => l.template.tenantId === tenantId)
    const ids = filtered.map((l) => l.template.id)
    const countMap = await projectSelfInspectionRepository.countByProjectAndTemplateIds(projectId, ids)
    return filtered.map((l) => ({
      id: l.template.id,
      tenantId: l.template.tenantId,
      name: l.template.name,
      description: l.template.description,
      status: l.template.status,
      recordCount: countMap.get(l.template.id) ?? 0,
      linkedAt: l.createdAt.toISOString(),
      createdAt: l.template.createdAt.toISOString(),
      updatedAt: l.template.updatedAt.toISOString(),
    }))
  },

  /** 租戶後台啟用中、且尚未匯入本專案之樣板（供勾選匯入） */
  async listAvailableTemplates(projectId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'read')
    const tenantId = await getProjectTenantId(projectId)
    const linkedIds = await projectSelfInspectionLinkRepository.findLinkedTemplateIds(projectId)
    const where: Prisma.SelfInspectionTemplateWhereInput = {
      tenantId,
      status: 'active',
    }
    if (linkedIds.length > 0) {
      where.id = { notIn: linkedIds }
    }
    const rows = await prisma.selfInspectionTemplate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      description: r.description,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  },

  /** 租戶啟用中樣板全集 + 是否已匯入本專案（供匯入 UI 勾選；已匯入列 disabled） */
  async listImportCatalog(projectId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'read')
    const tenantId = await getProjectTenantId(projectId)
    const linkedIds = new Set(await projectSelfInspectionLinkRepository.findLinkedTemplateIds(projectId))
    const rows = await prisma.selfInspectionTemplate.findMany({
      where: { tenantId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      description: r.description,
      status: r.status,
      imported: linkedIds.has(r.id),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  },

  async importTemplate(projectId: string, templateId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'create')
    const tenantId = await getProjectTenantId(projectId)
    const templateRow = await loadTemplateInTenant(templateId, tenantId)
    if (templateRow.status !== 'active') {
      throw new AppError(400, 'BAD_REQUEST', '僅能匯入啟用中的樣板')
    }
    const exists = await projectSelfInspectionLinkRepository.exists(projectId, templateId)
    if (exists) {
      throw new AppError(409, 'CONFLICT', '此樣板已匯入本專案')
    }
    let link: { createdAt: Date }
    try {
      link = await projectSelfInspectionLinkRepository.create(projectId, templateId)
    } catch (e) {
      if (e instanceof Error && e.message === 'SELF_INSPECTION_LINK_ALREADY_ACTIVE') {
        throw new AppError(409, 'CONFLICT', '此樣板已匯入本專案')
      }
      throw e
    }
    return {
      id: templateRow.id,
      tenantId: templateRow.tenantId,
      name: templateRow.name,
      description: templateRow.description,
      status: templateRow.status,
      recordCount: 0,
      linkedAt: link.createdAt.toISOString(),
      createdAt: templateRow.createdAt.toISOString(),
      updatedAt: templateRow.updatedAt.toISOString(),
    }
  },

  async removeTemplateFromProject(projectId: string, templateId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'delete')
    const tenantId = await getProjectTenantId(projectId)
    await loadTemplateInTenant(templateId, tenantId)
    const exists = await projectSelfInspectionLinkRepository.exists(projectId, templateId)
    if (!exists) {
      throw new AppError(404, 'NOT_FOUND', '此樣板未匯入本專案')
    }
    const n = await projectSelfInspectionRepository.countByProjectAndTemplate(projectId, templateId)
    if (n > 0) {
      throw new AppError(
        400,
        'BAD_REQUEST',
        '此樣板於本專案已有查驗紀錄，無法移除匯入'
      )
    }
    await projectSelfInspectionLinkRepository.delete(projectId, templateId, user.id)
  },

  async getTemplateForProject(projectId: string, templateId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'read')
    const tenantId = await getProjectTenantId(projectId)
    const templateRow = await loadTemplateInTenant(templateId, tenantId)
    await ensureTemplateLinkedToProject(projectId, templateId)
    const blocks = await selfInspectionBlockRepository.findManyByTemplateIdWithItems(templateId)
    const recordCount = await projectSelfInspectionRepository.countByProjectAndTemplate(projectId, templateId)
    return {
      template: toTemplateDetailDto(templateRow),
      blocks: blocks.map(toBlockWithItemsDto),
      recordCount,
    }
  },

  async listRecords(
    projectId: string,
    templateId: string,
    user: AuthUser,
    args: { page: number; limit: number }
  ) {
    await ensureInspection(projectId, user, 'read')
    const tenantId = await getProjectTenantId(projectId)
    await loadTemplateInTenant(templateId, tenantId)
    await ensureTemplateLinkedToProject(projectId, templateId)
    const limit = Math.min(50, Math.max(1, args.limit))
    const page = Math.max(1, args.page)
    const skip = (page - 1) * limit
    const [items, total] = await Promise.all([
      projectSelfInspectionRepository.findManyByProjectAndTemplate(projectId, templateId, { skip, take: limit }),
      projectSelfInspectionRepository.countByProjectAndTemplate(projectId, templateId),
    ])
    return { items: items.map(toRecordListDto), total, page, limit }
  },

  async createRecord(
    projectId: string,
    templateId: string,
    user: AuthUser,
    filledPayload: FilledPayloadInput
  ) {
    await ensureInspection(projectId, user, 'create')
    const tenantId = await getProjectTenantId(projectId)
    const templateRow = await loadTemplateInTenant(templateId, tenantId)
    await ensureTemplateLinkedToProject(projectId, templateId)
    assertTemplateActiveForCreate(templateRow)
    const blocks = await selfInspectionBlockRepository.findManyByTemplateIdWithItems(templateId)
    const header = mergeHeaderConfig(templateRow.headerConfig) as HeaderConfig
    validateFilledPayload(header, blocks, filledPayload)
    const structureSnapshot = buildStructureSnapshotJson(templateRow, blocks)
    const row = await projectSelfInspectionRepository.create({
      projectId,
      templateId,
      filledPayload: filledPayload as unknown as Prisma.InputJsonValue,
      structureSnapshot: structureSnapshot as unknown as Prisma.InputJsonValue,
      filledById: user.id,
    })
    return toRecordDetailDto(row)
  },

  async getRecord(projectId: string, templateId: string, recordId: string, user: AuthUser) {
    await ensureInspection(projectId, user, 'read')
    const tenantId = await getProjectTenantId(projectId)
    await loadTemplateInTenant(templateId, tenantId)
    await ensureTemplateLinkedToProject(projectId, templateId)
    const rec = await projectSelfInspectionRepository.findById(recordId)
    if (!rec || rec.projectId !== projectId || rec.templateId !== templateId) {
      return null
    }
    return toRecordDetailDto(rec)
  },
}
