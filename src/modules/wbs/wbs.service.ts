import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { wbsRepository, type WbsNodeRecord } from './wbs.repository.js'
import type { CreateWbsNodeBody, UpdateWbsNodeBody, MoveWbsNodeBody } from '../../schemas/wbs.js'
import type { PermissionAction } from '../project-permission/project-permission.service.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

export type WbsNodeTree = {
  id: string
  code: string
  name: string
  isProjectRoot: boolean
  startDate: string | null
  durationDays: number | null
  endDate: string | null // 依 startDate + durationDays 推算
  variableCost: number | null // 變動成本（資源×用量加總）
  resources: { id: string; name: string; type: string; unit: string; unitCost: number; quantity: number }[]
  children?: WbsNodeTree[]
}

async function ensureWbs(projectId: string, user: AuthUser, action: PermissionAction): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'project.wbs', action)
}

async function ensureResourceIdsInProject(projectId: string, resourceIds: string[]): Promise<void> {
  if (resourceIds.length === 0) return
  const found = await prisma.projectResource.findMany({
    where: { projectId, id: { in: resourceIds }, ...notDeleted },
    select: { id: true },
  })
  if (found.length !== resourceIds.length) {
    throw new AppError(400, 'BAD_REQUEST', '部分資源不屬於此專案或不存在')
  }
}

/** 從 body 取得資源指派清單（resourceAssignments 優先，否則 resourceIds 視為 quantity 1） */
function resolveResourceAssignments(body: {
  resourceIds?: string[]
  resourceAssignments?: { resourceId: string; quantity?: number }[]
}): { projectResourceId: string; quantity?: number }[] {
  if (body.resourceAssignments?.length) {
    return body.resourceAssignments.map((a) => ({
      projectResourceId: a.resourceId,
      quantity: a.quantity,
    }))
  }
  if (body.resourceIds?.length) {
    return body.resourceIds.map((projectResourceId) => ({ projectResourceId, quantity: 1 }))
  }
  return []
}

type FlatWithResources = WbsNodeRecord & {
  resources: { id: string; name: string; type: string; unit: string; unitCost: number; quantity: number }[]
}

/** 結束日 = 開始 + (工期−1) 日曆天（含開始日）；前置鏈才對完成日 +1 得後續開始 */
function toEndDate(startDate: Date | null, durationDays: number | null): string | null {
  if (!startDate || durationDays == null || durationDays < 1) return null
  const end = new Date(startDate)
  end.setDate(end.getDate() + durationDays - 1)
  return end.toISOString().slice(0, 10)
}

function buildTree(flat: FlatWithResources[], parentId: string | null): WbsNodeTree[] {
  return flat
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((n) => ({
      id: n.id,
      code: n.code,
      name: n.name,
      isProjectRoot: n.isProjectRoot,
      startDate: n.startDate ? n.startDate.toISOString().slice(0, 10) : null,
      durationDays: n.durationDays,
      endDate: toEndDate(n.startDate, n.durationDays),
      variableCost: n.variableCost ?? null,
      resources: n.resources ?? [],
      children: buildTree(flat, n.id).length > 0 ? buildTree(flat, n.id) : undefined,
    }))
}

function recalculateCodes(nodes: WbsNodeRecord[], parentCode: string | null = null): { id: string; code: string }[] {
  const byParent = new Map<string | null, WbsNodeRecord[]>()
  for (const n of nodes) {
    const key = n.parentId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(n)
  }
  const result: { id: string; code: string }[] = []
  function visit(pid: string | null, prefix: string) {
    const list = byParent.get(pid) ?? []
    list.sort((a, b) => a.sortOrder - b.sortOrder)
    list.forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      result.push({ id: n.id, code })
      visit(n.id, code)
    })
  }
  visit(null, '')
  return result
}

async function getProjectRootId(projectId: string): Promise<string> {
  const r = await prisma.wbsNode.findFirst({
    where: { projectId, isProjectRoot: true },
    select: { id: true },
  })
  if (!r) {
    throw new AppError(500, 'INTERNAL_ERROR', '專案缺少 WBS 專案根節點，請聯絡管理員')
  }
  return r.id
}

async function syncWbsCodesIfNeeded(projectId: string): Promise<void> {
  const flat = await wbsRepository.findManyByProjectId(projectId)
  const updates = recalculateCodes(flat)
  for (const u of updates) {
    const n = flat.find((x) => x.id === u.id)
    if (n && n.code !== u.code) {
      await wbsRepository.update(u.id, { code: u.code })
    }
  }
}

export const wbsService = {
  async list(projectId: string, user: AuthUser): Promise<WbsNodeTree[]> {
    await ensureWbs(projectId, user, 'read')
    await syncWbsCodesIfNeeded(projectId)
    const flat = await wbsRepository.findManyByProjectIdWithResources(projectId)
    return buildTree(flat, null)
  },

  async create(projectId: string, body: CreateWbsNodeBody, user: AuthUser): Promise<WbsNodeRecord> {
    await ensureWbs(projectId, user, 'create')
    const rootId = await getProjectRootId(projectId)
    const parentId = body.parentId != null && body.parentId !== '' ? body.parentId : rootId
    {
      const parent = await wbsRepository.findById(parentId)
      if (!parent || parent.projectId !== projectId) {
        throw new AppError(404, 'NOT_FOUND', '找不到指定的父節點')
      }
    }
    const flat = await wbsRepository.findManyByProjectId(projectId)
    const siblings = flat.filter((n) => n.parentId === parentId)
    const sortOrder = siblings.length
    const parent = parentId ? flat.find((n) => n.id === parentId) : null
    const parentCode = parent?.code ?? null
    const code = parentCode ? `${parentCode}.${sortOrder + 1}` : String(sortOrder + 1)
    const startDate =
      body.startDate != null && body.startDate !== ''
        ? new Date(body.startDate as string)
        : undefined
    const node = await wbsRepository.create({
      projectId,
      parentId,
      code,
      name: body.name.trim(),
      sortOrder,
      startDate: startDate ?? null,
      durationDays: body.durationDays ?? null,
    })
    const assignments = resolveResourceAssignments(body)
    if (assignments.length > 0) {
      await ensureResourceIdsInProject(projectId, assignments.map((a) => a.projectResourceId))
      await wbsRepository.setNodeResourceAssignments(node.id, assignments)
      await wbsRepository.recomputeAndUpdateVariableCost(node.id)
    }
    return (await wbsRepository.findById(node.id)) ?? node
  },

  async update(projectId: string, id: string, body: UpdateWbsNodeBody, user: AuthUser): Promise<WbsNodeRecord> {
    await ensureWbs(projectId, user, 'update')
    const existing = await wbsRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該 WBS 節點')
    }
    if (existing.isProjectRoot) {
      throw new AppError(400, 'BAD_REQUEST', '專案根節點（專案名稱層）不可修改')
    }
    const hasChildren =
      (await prisma.wbsNode.count({ where: { parentId: id, ...notDeleted } })) > 0
    const updates: Parameters<typeof wbsRepository.update>[1] = {}
    if (body.name !== undefined) updates.name = body.name.trim()
    /** 父節點僅允許改名稱；排程與資源由子項決定 */
    if (!hasChildren) {
      if (body.startDate !== undefined) {
        updates.startDate = body.startDate != null && body.startDate !== '' ? new Date(body.startDate) : null
      }
      if (body.durationDays !== undefined) updates.durationDays = body.durationDays
    }
    if (Object.keys(updates).length > 0) {
      await wbsRepository.update(id, updates)
    }
    if (
      !hasChildren &&
      (body.resourceIds !== undefined || body.resourceAssignments !== undefined)
    ) {
      const assignments = resolveResourceAssignments(body)
      await ensureResourceIdsInProject(projectId, assignments.map((a) => a.projectResourceId))
      await wbsRepository.setNodeResourceAssignments(id, assignments)
      await wbsRepository.recomputeAndUpdateVariableCost(id)
    }
    return (await wbsRepository.findById(id)) ?? existing
  },

  async delete(projectId: string, id: string, user: AuthUser): Promise<void> {
    await ensureWbs(projectId, user, 'delete')
    const existing = await wbsRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該 WBS 節點')
    }
    if (existing.isProjectRoot) {
      throw new AppError(400, 'BAD_REQUEST', '不可刪除專案根節點')
    }
    await wbsRepository.softDeleteSubtree(projectId, id, user.id)
    const flat = await wbsRepository.findManyByProjectId(projectId)
    await applyCodeUpdates(flat)
  },

  async move(projectId: string, id: string, body: MoveWbsNodeBody, user: AuthUser): Promise<WbsNodeTree[]> {
    await ensureWbs(projectId, user, 'update')
    const node = await wbsRepository.findById(id)
    if (!node || node.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該 WBS 節點')
    }
    if (node.isProjectRoot) {
      throw new AppError(400, 'BAD_REQUEST', '不可移動專案根節點')
    }
    const rootId = await getProjectRootId(projectId)
    const newParentId =
      body.parentId != null && body.parentId !== '' ? body.parentId : rootId
    {
      const parent = await wbsRepository.findById(newParentId)
      if (!parent || parent.projectId !== projectId) {
        throw new AppError(404, 'NOT_FOUND', '找不到指定的父節點')
      }
      const descendantIds = getDescendantIds(
        await wbsRepository.findManyByProjectId(projectId),
        id
      )
      if (descendantIds.includes(newParentId)) {
        throw new AppError(400, 'BAD_REQUEST', '不能移動到自己底下')
      }
    }
    const flat = await wbsRepository.findManyByProjectId(projectId)
    const oldParentId = node.parentId
    if (oldParentId !== newParentId) {
      const oldSiblings = flat.filter((n) => n.parentId === oldParentId && n.sortOrder > node.sortOrder)
      for (const n of oldSiblings) {
        await wbsRepository.update(n.id, { sortOrder: n.sortOrder - 1 })
      }
    }
    const targetSiblings = flat.filter((n) => n.parentId === newParentId && n.id !== id)
    let sortOrder: number
    if (body.insertBeforeId) {
      const ref = flat.find((n) => n.id === body.insertBeforeId)
      if (ref && ref.parentId === newParentId) {
        sortOrder = ref.sortOrder
        for (const n of targetSiblings) {
          if (n.sortOrder >= sortOrder) {
            await wbsRepository.update(n.id, { sortOrder: n.sortOrder + 1 })
          }
        }
      } else {
        sortOrder = targetSiblings.length
      }
    } else {
      sortOrder = targetSiblings.length
    }
    await wbsRepository.update(id, { parentId: newParentId, sortOrder })
    const updatedFlat = await wbsRepository.findManyByProjectId(projectId)
    await applyCodeUpdates(updatedFlat)
    return this.list(projectId, user)
  },
}

function getDescendantIds(flat: WbsNodeRecord[], parentId: string): string[] {
  const ids: string[] = []
  function collect(pid: string | null) {
    for (const n of flat) {
      if (n.parentId === pid) {
        ids.push(n.id)
        collect(n.id)
      }
    }
  }
  collect(parentId)
  return ids
}

async function applyCodeUpdates(flat: WbsNodeRecord[]): Promise<void> {
  const updates = recalculateCodes(flat)
  for (const u of updates) {
    await wbsRepository.update(u.id, { code: u.code })
  }
}
