import crypto from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { projectRepository } from '../project/project.repository.js'
import { fileRepository, type AttachmentRecord } from './file.repository.js'
import { storage } from '../../lib/storage.js'
import {
  FILE_CATEGORY_PHOTO,
  FILE_CATEGORY_PCCES_XML,
  UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES,
} from '../../constants/file.js'
import { prisma } from '../../lib/db.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

const DRAWING_REVISION = 'drawing_revision'

async function ensureProjectFile(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'delete',
  category: string | null | undefined
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  if (category === DRAWING_REVISION) {
    await assertProjectModuleAction(user, projectId, 'project.drawings', action)
  } else if (category === FILE_CATEGORY_PHOTO) {
    await assertProjectModuleAction(user, projectId, 'construction.photo', action)
  } else if (category === FILE_CATEGORY_PCCES_XML) {
    await assertProjectModuleAction(user, projectId, 'construction.pcces', action)
  } else {
    await assertProjectModuleAction(user, projectId, 'construction.upload', action)
  }
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function buildStorageKey(tenantId: string | null, projectId: string, fileName: string): string {
  const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const prefix = tenantId ? `${tenantId}/${projectId}` : `_/${projectId}`
  return `${prefix}/${uid}_${safe}`
}

export const fileService = {
  async uploadFile(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    projectId: string,
    userId: string,
    user: AuthUser,
    options: { category?: string; businessId?: string } = {}
  ): Promise<AttachmentRecord> {
    await ensureProjectFile(projectId, user, 'create', options.category)

    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    }

    const tenantId = project.tenantId
    const fileSize = buffer.length

    // 單檔上限
    const tenant = tenantId ? await prisma.tenant.findFirst({ where: { id: tenantId, ...notDeleted } }) : null
    const fileLimitBytes = tenant?.fileSizeLimitMb != null
      ? tenant.fileSizeLimitMb * 1024 * 1024
      : UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES
    if (fileSize > fileLimitBytes) {
      throw new AppError(
        403,
        'FILE_SIZE_EXCEEDED',
        `單一檔案不得超過 ${tenant?.fileSizeLimitMb ?? Math.round(UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES / 1024 / 1024)} MB`
      )
    }

    // 總量配額（僅有租戶時檢查）
    if (tenantId && tenant?.storageQuotaMb != null) {
      const usage = await fileRepository.getTenantStorageUsageBytesSimple(tenantId)
      const quotaBytes = tenant.storageQuotaMb * 1024 * 1024
      if (usage + fileSize > quotaBytes) {
        throw new AppError(
          403,
          'STORAGE_QUOTA_EXCEEDED',
          `儲存空間已達上限（已用 ${Math.round(usage / 1024 / 1024)} MB / 上限 ${tenant.storageQuotaMb} MB）`
        )
      }
    }

    const fileHash = sha256(buffer)
    const existing = await fileRepository.findByProjectAndHash(projectId, fileHash)
    let storageKey: string

    if (existing) {
      storageKey = existing.storageKey
      // 去重：不寫入新實體，只建一筆新記錄
    } else {
      storageKey = buildStorageKey(tenantId, projectId, fileName)
      await storage.upload(buffer, storageKey, mimeType)
    }

    const attachment = await fileRepository.create({
      projectId,
      tenantId,
      storageKey,
      fileName,
      fileSize,
      mimeType,
      fileHash,
      category: options.category ?? null,
      businessId: options.businessId ?? null,
      uploadedById: userId,
    })
    return attachment
  },

  async getById(
    id: string,
    userId: string,
    user: AuthUser
  ): Promise<AttachmentRecord & { stream?: import('node:stream').Readable; contentType?: string }> {
    const att = await fileRepository.findById(id)
    if (!att) {
      throw new AppError(404, 'NOT_FOUND', '找不到該檔案')
    }
    await ensureProjectFile(att.projectId, user, 'read', att.category)
    const { stream, contentType } = await storage.getStream(att.storageKey)
    return { ...att, stream, contentType: contentType ?? att.mimeType }
  },

  async getByIdMetadata(id: string, userId: string, user: AuthUser): Promise<AttachmentRecord> {
    const att = await fileRepository.findById(id)
    if (!att) {
      throw new AppError(404, 'NOT_FOUND', '找不到該檔案')
    }
    await ensureProjectFile(att.projectId, user, 'read', att.category)
    return att
  },

  async listByProject(
    projectId: string,
    args: { page: number; limit: number; category?: string },
    userId: string,
    user: AuthUser
  ): Promise<{ items: (AttachmentRecord & { uploaderName?: string | null })[]; total: number }> {
    await ensureProjectFile(projectId, user, 'read', args.category)
    const skip = (args.page - 1) * args.limit
    const { items, total } = await fileRepository.findByProjectId(projectId, {
      skip,
      take: args.limit,
      category: args.category,
    })
    const withUser = items.map((row: AttachmentRecord & { uploadedBy?: { name: string | null } }) => ({
      id: row.id,
      projectId: row.projectId,
      tenantId: row.tenantId,
      storageKey: row.storageKey,
      fileName: row.fileName,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      fileHash: row.fileHash,
      category: row.category,
      businessId: row.businessId,
      uploadedById: row.uploadedById,
      createdAt: row.createdAt,
      uploaderName: (row as { uploadedBy?: { name: string | null } }).uploadedBy?.name ?? null,
    }))
    return { items: withUser, total }
  },

  async delete(id: string, userId: string, user: AuthUser): Promise<void> {
    const att = await fileRepository.findById(id)
    if (!att) {
      throw new AppError(404, 'NOT_FOUND', '找不到該檔案')
    }
    await ensureProjectFile(att.projectId, user, 'delete', att.category)

    const refCount = await fileRepository.countByStorageKey(att.storageKey)
    const removed = await fileRepository.softDelete(id, userId)
    if (!removed) {
      throw new AppError(404, 'NOT_FOUND', '找不到該檔案')
    }
    if (refCount <= 1) {
      await storage.delete(att.storageKey)
    }
  },

  async getTenantStorageUsage(tenantId: string): Promise<{ usageBytes: number }> {
    const usageBytes = await fileRepository.getTenantStorageUsageBytesSimple(tenantId)
    return { usageBytes }
  },
}
