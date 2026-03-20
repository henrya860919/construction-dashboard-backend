import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import {
  repairRequestRepository,
  repairExecutionRecordRepository,
  type RepairListItem,
  type RepairExecutionRecordRow,
} from './repair-request.repository.js'
import type {
  CreateRepairRequestBody,
  UpdateRepairRequestBody,
  CreateRepairExecutionRecordBody,
} from '../../schemas/repair-request.js'

const REPAIR_PHOTO_CATEGORY = 'repair_photo'
const REPAIR_FILE_CATEGORY = 'repair_attachment'
const REPAIR_RECORD_PHOTO_CATEGORY = 'repair_record'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensureRepair(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'update' | 'delete'
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'repair.record', action)
}

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

function parseOptionalDateInput(s: string | undefined): Date | null {
  if (s === undefined) return null
  const t = s.trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T12:00:00.000Z`)
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

/** PATCH：null 表示清空日期；undefined 表示不更新 */
function parsePatchDate(
  val: string | null | undefined
): Date | null | undefined {
  if (val === undefined) return undefined
  if (val === null) return null
  return parseOptionalDateInput(val)
}

export const repairRequestService = {
  async list(
    projectId: string,
    args: { status?: string; page?: number; limit?: number },
    user: AuthUser
  ): Promise<{ items: RepairListItem[]; total: number }> {
    await ensureRepair(projectId, user, 'read')
    const limit = Math.min(50, Math.max(1, args.limit ?? 20))
    const page = Math.max(1, args.page ?? 1)
    const skip = (page - 1) * limit
    const [items, total] = await Promise.all([
      repairRequestRepository.findManyByProject(projectId, {
        status: args.status,
        skip,
        take: limit,
      }),
      repairRequestRepository.countByProject(projectId, args.status),
    ])
    return { items, total }
  },

  async getById(
    projectId: string,
    repairId: string,
    user: AuthUser
  ): Promise<(RepairListItem & { photos: AttachmentMeta[]; attachments: AttachmentMeta[] }) | null> {
    await ensureRepair(projectId, user, 'read')
    const row = await repairRequestRepository.findById(repairId)
    if (!row || row.projectId !== projectId) return null
    const [photos, attachments] = await Promise.all([
      getAttachmentsByBusiness(projectId, repairId, REPAIR_PHOTO_CATEGORY),
      getAttachmentsByBusiness(projectId, repairId, REPAIR_FILE_CATEGORY),
    ])
    return { ...row, photos, attachments }
  },

  async create(projectId: string, body: CreateRepairRequestBody, user: AuthUser): Promise<RepairListItem> {
    await ensureRepair(projectId, user, 'create')
    const repair = await repairRequestRepository.create({
      projectId,
      customerName: body.customerName.trim(),
      contactPhone: body.contactPhone.trim(),
      repairContent: body.repairContent.trim(),
      unitLabel: body.unitLabel?.trim() || null,
      remarks: body.remarks?.trim() || null,
      problemCategory: body.problemCategory.trim(),
      isSecondRepair: body.isSecondRepair ?? false,
      deliveryDate: parseOptionalDateInput(body.deliveryDate),
      repairDate: parseOptionalDateInput(body.repairDate),
      status: body.status,
    })
    if (body.photoAttachmentIds?.length) {
      await linkAttachments(projectId, body.photoAttachmentIds, repair.id, REPAIR_PHOTO_CATEGORY)
    }
    if (body.fileAttachmentIds?.length) {
      await linkAttachments(projectId, body.fileAttachmentIds, repair.id, REPAIR_FILE_CATEGORY)
    }
    return repair
  },

  async update(
    projectId: string,
    repairId: string,
    body: UpdateRepairRequestBody,
    user: AuthUser
  ): Promise<RepairListItem> {
    await ensureRepair(projectId, user, 'update')
    const existing = await repairRequestRepository.findById(repairId)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該報修單')
    }
    const deliveryDate = parsePatchDate(body.deliveryDate)
    const repairDate = parsePatchDate(body.repairDate)
    return repairRequestRepository.update(repairId, {
      ...(body.customerName !== undefined && { customerName: body.customerName.trim() }),
      ...(body.contactPhone !== undefined && { contactPhone: body.contactPhone.trim() }),
      ...(body.repairContent !== undefined && { repairContent: body.repairContent.trim() }),
      ...(body.unitLabel !== undefined && { unitLabel: body.unitLabel?.trim() || null }),
      ...(body.remarks !== undefined && { remarks: body.remarks?.trim() || null }),
      ...(body.problemCategory !== undefined && { problemCategory: body.problemCategory.trim() }),
      ...(body.isSecondRepair !== undefined && { isSecondRepair: body.isSecondRepair }),
      ...(deliveryDate !== undefined && { deliveryDate }),
      ...(repairDate !== undefined && { repairDate }),
      ...(body.status !== undefined && { status: body.status }),
    })
  },

  async delete(projectId: string, repairId: string, user: AuthUser): Promise<void> {
    await ensureRepair(projectId, user, 'delete')
    const existing = await repairRequestRepository.findById(repairId)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該報修單')
    }
    await repairRequestRepository.delete(repairId, user.id)
  },

  async listRecords(
    repairId: string,
    projectId: string,
    user: AuthUser
  ): Promise<(RepairExecutionRecordRow & { photos: AttachmentMeta[] })[]> {
    await ensureRepair(projectId, user, 'read')
    const repair = await repairRequestRepository.findById(repairId)
    if (!repair || repair.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該報修單')
    }
    const records = await repairExecutionRecordRepository.findManyByRepairId(repairId)
    if (records.length === 0) return []
    const recordIds = records.map((r) => r.id)
    const allPhotos = await prisma.attachment.findMany({
      where: { projectId, category: REPAIR_RECORD_PHOTO_CATEGORY, businessId: { in: recordIds } },
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
    repairId: string,
    recordId: string,
    user: AuthUser
  ): Promise<(RepairExecutionRecordRow & { photos: AttachmentMeta[] }) | null> {
    await ensureRepair(projectId, user, 'read')
    const repair = await repairRequestRepository.findById(repairId)
    if (!repair || repair.projectId !== projectId) return null
    const record = await repairExecutionRecordRepository.findById(recordId)
    if (!record || record.repairId !== repairId) return null
    const photos = await getAttachmentsByBusiness(projectId, recordId, REPAIR_RECORD_PHOTO_CATEGORY)
    return { ...record, photos }
  },

  async createRecord(
    projectId: string,
    repairId: string,
    body: CreateRepairExecutionRecordBody,
    user: AuthUser
  ): Promise<RepairExecutionRecordRow> {
    await ensureRepair(projectId, user, 'create')
    const repair = await repairRequestRepository.findById(repairId)
    if (!repair || repair.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該報修單')
    }
    const record = await repairExecutionRecordRepository.create({
      repairId,
      content: body.content.trim(),
      recordedById: user.id,
    })
    if (body.attachmentIds?.length) {
      await linkAttachments(projectId, body.attachmentIds, record.id, REPAIR_RECORD_PHOTO_CATEGORY)
    }
    return record
  },
}
