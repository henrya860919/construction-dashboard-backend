import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import {
  defectImprovementRepository,
  defectExecutionRecordRepository,
  type DefectListItem,
  type DefectExecutionRecordRow,
} from './defect-improvement.repository.js'
import type {
  CreateDefectImprovementBody,
  UpdateDefectImprovementBody,
  CreateDefectExecutionRecordBody,
} from '../../schemas/defect-improvement.js'

const DEFECT_PHOTO_CATEGORY = 'defect'
const DEFECT_RECORD_PHOTO_CATEGORY = 'defect_record'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensureDefect(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'update' | 'delete'
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'construction.defect', action)
}

/** 將已上傳的附件綁定到業務 ID（缺陷或執行紀錄） */
async function linkAttachments(
  projectId: string,
  attachmentIds: string[],
  businessId: string,
  category: string
): Promise<void> {
  if (attachmentIds.length === 0) return
  await prisma.attachment.updateMany({
    where: { id: { in: attachmentIds }, projectId },
    data: { businessId, category },
  })
}

export type AttachmentMeta = {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: string
  url: string
}

async function getAttachmentsByBusiness(
  projectId: string,
  businessId: string,
  category: string
): Promise<AttachmentMeta[]> {
  const list = await prisma.attachment.findMany({
    where: { projectId, businessId, category },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileName: true, fileSize: true, mimeType: true, createdAt: true },
  })
  return list.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    createdAt: a.createdAt.toISOString(),
    url: `/api/v1/files/${a.id}`,
  }))
}

export const defectImprovementService = {
  async list(
    projectId: string,
    args: { status?: string; page?: number; limit?: number },
    user: AuthUser
  ): Promise<{ items: DefectListItem[]; total: number }> {
    await ensureDefect(projectId, user, 'read')
    const limit = Math.min(50, Math.max(1, args.limit ?? 20))
    const page = Math.max(1, args.page ?? 1)
    const skip = (page - 1) * limit
    const [items, total] = await Promise.all([
      defectImprovementRepository.findManyByProject(projectId, {
        status: args.status,
        skip,
        take: limit,
      }),
      defectImprovementRepository.countByProject(projectId, args.status),
    ])
    return { items, total }
  },

  async getById(
    projectId: string,
    defectId: string,
    user: AuthUser
  ): Promise<(DefectListItem & { photos: AttachmentMeta[] }) | null> {
    await ensureDefect(projectId, user, 'read')
    const defect = await defectImprovementRepository.findById(defectId)
    if (!defect || defect.projectId !== projectId) return null
    const photos = await getAttachmentsByBusiness(projectId, defectId, DEFECT_PHOTO_CATEGORY)
    return { ...defect, photos }
  },

  async listRecords(
    defectId: string,
    projectId: string,
    user: AuthUser
  ): Promise<(DefectExecutionRecordRow & { photos: AttachmentMeta[] })[]> {
    await ensureDefect(projectId, user, 'read')
    const defect = await defectImprovementRepository.findById(defectId)
    if (!defect || defect.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該缺失改善')
    }
    const records = await defectExecutionRecordRepository.findManyByDefectId(defectId)
    if (records.length === 0) return []
    const recordIds = records.map((r) => r.id)
    const allPhotos = await prisma.attachment.findMany({
      where: { projectId, category: DEFECT_RECORD_PHOTO_CATEGORY, businessId: { in: recordIds } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fileName: true, fileSize: true, mimeType: true, createdAt: true, businessId: true },
    })
    const photosByRecordId = new Map<string, AttachmentMeta[]>()
    for (const a of allPhotos) {
      const bid = a.businessId as string
      if (!photosByRecordId.has(bid)) photosByRecordId.set(bid, [])
      photosByRecordId.get(bid)!.push({
        id: a.id,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(),
        url: `/api/v1/files/${a.id}`,
      })
    }
    return records.map((r) => ({
      ...r,
      photos: photosByRecordId.get(r.id) ?? [],
    }))
  },

  async getRecordById(
    projectId: string,
    defectId: string,
    recordId: string,
    user: AuthUser
  ): Promise<(DefectExecutionRecordRow & { photos: AttachmentMeta[] }) | null> {
    await ensureDefect(projectId, user, 'read')
    const defect = await defectImprovementRepository.findById(defectId)
    if (!defect || defect.projectId !== projectId) return null
    const record = await defectExecutionRecordRepository.findById(recordId)
    if (!record || record.defectId !== defectId) return null
    const photos = await getAttachmentsByBusiness(projectId, recordId, DEFECT_RECORD_PHOTO_CATEGORY)
    return { ...record, photos }
  },

  async create(projectId: string, body: CreateDefectImprovementBody, user: AuthUser): Promise<DefectListItem> {
    await ensureDefect(projectId, user, 'create')
    const defect = await defectImprovementRepository.create({
      projectId,
      description: body.description.trim(),
      discoveredBy: body.discoveredBy.trim(),
      priority: body.priority,
      floor: body.floor?.trim() || null,
      location: body.location?.trim() || null,
      status: body.status,
    })
    if (body.attachmentIds?.length) {
      await linkAttachments(projectId, body.attachmentIds, defect.id, DEFECT_PHOTO_CATEGORY)
    }
    return defect
  },

  async update(
    projectId: string,
    defectId: string,
    body: UpdateDefectImprovementBody,
    user: AuthUser
  ): Promise<DefectListItem> {
    await ensureDefect(projectId, user, 'update')
    const existing = await defectImprovementRepository.findById(defectId)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該缺失改善')
    }
    return defectImprovementRepository.update(defectId, {
      ...(body.description !== undefined && { description: body.description.trim() }),
      ...(body.discoveredBy !== undefined && { discoveredBy: body.discoveredBy.trim() }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.floor !== undefined && { floor: body.floor?.trim() || null }),
      ...(body.location !== undefined && { location: body.location?.trim() || null }),
      ...(body.status !== undefined && { status: body.status }),
    })
  },

  async delete(projectId: string, defectId: string, user: AuthUser): Promise<void> {
    await ensureDefect(projectId, user, 'delete')
    const existing = await defectImprovementRepository.findById(defectId)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該缺失改善')
    }
    await defectImprovementRepository.delete(defectId, user.id)
  },

  async createRecord(
    projectId: string,
    defectId: string,
    body: CreateDefectExecutionRecordBody,
    user: AuthUser
  ): Promise<DefectExecutionRecordRow> {
    await ensureDefect(projectId, user, 'create')
    const defect = await defectImprovementRepository.findById(defectId)
    if (!defect || defect.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該缺失改善')
    }
    const record = await defectExecutionRecordRepository.create({
      defectId,
      content: body.content.trim(),
      recordedById: user.id,
    })
    if (body.attachmentIds?.length) {
      await linkAttachments(projectId, body.attachmentIds, record.id, DEFECT_RECORD_PHOTO_CATEGORY)
    }
    return record
  },
}
