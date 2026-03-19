import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { drawingNodeRepository, type DrawingNodeRecord } from './drawing-node.repository.js'
import type { CreateDrawingNodeBody, UpdateDrawingNodeBody, MoveDrawingNodeBody } from '../../schemas/drawing-node.js'
import { fileService } from '../file/file.service.js'

export const DRAWING_REVISION_CATEGORY = 'drawing_revision'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

export type DrawingLatestFileDto = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: string
}

export type DrawingNodeTree = {
  id: string
  kind: 'folder' | 'leaf'
  name: string
  latestFile: DrawingLatestFileDto | null
  children?: DrawingNodeTree[]
}

async function ensureProjectTenant(projectId: string, user: AuthUser): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { tenantId: true },
  })
  if (!project) throw new AppError(404, 'NOT_FOUND', '找不到該專案')
  if (user.systemRole !== 'platform_admin' && project.tenantId !== user.tenantId) {
    throw new AppError(403, 'FORBIDDEN', '無權限操作此專案的圖說')
  }
}

async function ensureUserCanAccessProject(
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean
): Promise<void> {
  if (isPlatformAdmin) return
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { status: true },
  })
  if (!member || member.status !== 'active') {
    throw new AppError(403, 'FORBIDDEN', '非專案成員或已停用，無法存取圖說管理')
  }
}

async function ensureDrawingAccess(projectId: string, user: AuthUser): Promise<void> {
  await ensureProjectTenant(projectId, user)
  await ensureUserCanAccessProject(projectId, user.id, user.systemRole === 'platform_admin')
}

function normalizeParentId(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null
  return raw
}

function buildTree(flat: DrawingNodeRecord[], parentId: string | null): DrawingNodeTree[] {
  return flat
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((n) => ({
      id: n.id,
      kind: n.kind === 'leaf' ? 'leaf' : 'folder',
      name: n.name,
      latestFile: null as DrawingLatestFileDto | null,
      children:
        n.kind === 'folder' && flat.some((c) => c.parentId === n.id)
          ? buildTree(flat, n.id)
          : n.kind === 'folder'
            ? []
            : undefined,
    }))
}

async function attachLatestFiles(
  projectId: string,
  tree: DrawingNodeTree[]
): Promise<DrawingNodeTree[]> {
  const leafIds: string[] = []
  function collect(nodes: DrawingNodeTree[]) {
    for (const n of nodes) {
      if (n.kind === 'leaf') leafIds.push(n.id)
      else if (n.children?.length) collect(n.children)
    }
  }
  collect(tree)
  if (leafIds.length === 0) return tree

  const attachments = await prisma.attachment.findMany({
    where: {
      projectId,
      category: DRAWING_REVISION_CATEGORY,
      businessId: { in: leafIds },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      businessId: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      createdAt: true,
    },
  })
  const latestByLeaf = new Map<string, DrawingLatestFileDto>()
  for (const a of attachments) {
    if (!a.businessId || latestByLeaf.has(a.businessId)) continue
    latestByLeaf.set(a.businessId, {
      id: a.id,
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      createdAt: a.createdAt.toISOString(),
    })
  }

  function mapNodes(nodes: DrawingNodeTree[]): DrawingNodeTree[] {
    return nodes.map((n) => ({
      ...n,
      latestFile: n.kind === 'leaf' ? latestByLeaf.get(n.id) ?? null : null,
      children: n.children?.length ? mapNodes(n.children) : n.children,
    }))
  }
  return mapNodes(tree)
}

function getDescendantIds(flat: DrawingNodeRecord[], nodeId: string): string[] {
  const ids: string[] = []
  function collect(pid: string) {
    for (const n of flat) {
      if (n.parentId === pid) {
        ids.push(n.id)
        collect(n.id)
      }
    }
  }
  collect(nodeId)
  return ids
}

function collectAllLeafIdsInSubtree(flat: DrawingNodeRecord[], rootId: string): string[] {
  const desc = getDescendantIds(flat, rootId)
  const allIds = [rootId, ...desc]
  return flat.filter((n) => allIds.includes(n.id) && n.kind === 'leaf').map((n) => n.id)
}

export const drawingNodeService = {
  async list(projectId: string, user: AuthUser): Promise<DrawingNodeTree[]> {
    await ensureDrawingAccess(projectId, user)
    const flat = await drawingNodeRepository.findManyByProjectId(projectId)
    const tree = buildTree(flat, null)
    return attachLatestFiles(projectId, tree)
  },

  async create(projectId: string, body: CreateDrawingNodeBody, user: AuthUser): Promise<DrawingNodeTree[]> {
    await ensureDrawingAccess(projectId, user)
    const parentId = normalizeParentId(body.parentId)
    if (parentId) {
      const parent = await drawingNodeRepository.findById(parentId)
      if (!parent || parent.projectId !== projectId) {
        throw new AppError(404, 'NOT_FOUND', '找不到父節點')
      }
      if (parent.kind !== 'folder') {
        throw new AppError(400, 'BAD_REQUEST', '圖說項目下不可再新增子節點')
      }
    }
    const flat = await drawingNodeRepository.findManyByProjectId(projectId)
    const siblings = flat.filter((n) => n.parentId === parentId)
    const sortOrder = siblings.length
    await drawingNodeRepository.create({
      projectId,
      parentId,
      kind: body.kind,
      name: body.name.trim(),
      sortOrder,
    })
    return this.list(projectId, user)
  },

  async update(
    projectId: string,
    id: string,
    body: UpdateDrawingNodeBody,
    user: AuthUser
  ): Promise<DrawingNodeTree[]> {
    await ensureDrawingAccess(projectId, user)
    const existing = await drawingNodeRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該節點')
    }
    await drawingNodeRepository.update(id, { name: body.name.trim() })
    return this.list(projectId, user)
  },

  async delete(projectId: string, id: string, user: AuthUser): Promise<void> {
    await ensureDrawingAccess(projectId, user)
    const existing = await drawingNodeRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該節點')
    }
    const flat = await drawingNodeRepository.findManyByProjectId(projectId)
    const leafIds = collectAllLeafIdsInSubtree(flat, id)
    for (const leafId of leafIds) {
      const atts = await prisma.attachment.findMany({
        where: {
          projectId,
          businessId: leafId,
          category: DRAWING_REVISION_CATEGORY,
        },
        select: { id: true },
      })
      for (const a of atts) {
        await fileService.delete(a.id, user.id, user)
      }
    }
    await drawingNodeRepository.deleteById(id)
  },

  async move(projectId: string, id: string, body: MoveDrawingNodeBody, user: AuthUser): Promise<DrawingNodeTree[]> {
    await ensureDrawingAccess(projectId, user)
    const node = await drawingNodeRepository.findById(id)
    if (!node || node.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該節點')
    }
    const newParentId = normalizeParentId(body.parentId)
    if (newParentId) {
      const parent = await drawingNodeRepository.findById(newParentId)
      if (!parent || parent.projectId !== projectId) {
        throw new AppError(404, 'NOT_FOUND', '找不到指定的父節點')
      }
      if (parent.kind !== 'folder') {
        throw new AppError(400, 'BAD_REQUEST', '不可將節點移到圖說項目底下')
      }
      const flat = await drawingNodeRepository.findManyByProjectId(projectId)
      const descendantIds = getDescendantIds(flat, id)
      if (descendantIds.includes(newParentId)) {
        throw new AppError(400, 'BAD_REQUEST', '不能移動到自己底下')
      }
    }
    const flat = await drawingNodeRepository.findManyByProjectId(projectId)
    const oldParentId = node.parentId
    if (oldParentId !== newParentId) {
      const oldSiblings = flat.filter((n) => n.parentId === oldParentId && n.sortOrder > node.sortOrder)
      for (const n of oldSiblings) {
        await drawingNodeRepository.update(n.id, { sortOrder: n.sortOrder - 1 })
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
            await drawingNodeRepository.update(n.id, { sortOrder: n.sortOrder + 1 })
          }
        }
      } else {
        sortOrder = targetSiblings.length
      }
    } else {
      sortOrder = targetSiblings.length
    }
    await drawingNodeRepository.update(id, { parentId: newParentId, sortOrder })
    return this.list(projectId, user)
  },

  async listRevisions(projectId: string, nodeId: string, user: AuthUser) {
    await ensureDrawingAccess(projectId, user)
    const existing = await drawingNodeRepository.findById(nodeId)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該節點')
    }
    if (existing.kind !== 'leaf') {
      throw new AppError(400, 'BAD_REQUEST', '僅圖說項目可查詢檔案版本')
    }
    const rows = await prisma.attachment.findMany({
      where: {
        projectId,
        businessId: nodeId,
        category: DRAWING_REVISION_CATEGORY,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    })
    return rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      createdAt: a.createdAt.toISOString(),
      uploadedBy: a.uploadedBy
        ? { id: a.uploadedBy.id, name: a.uploadedBy.name, email: a.uploadedBy.email }
        : null,
      url: `/api/v1/files/${a.id}`,
    }))
  },
}
