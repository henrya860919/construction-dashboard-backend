import crypto from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { formTemplateRepository } from './form-template.repository.js'
import { storage } from '../../lib/storage.js'
import { projectRepository } from '../project/project.repository.js'
import { UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES } from '../../constants/file.js'
import { prisma } from '../../lib/db.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensureCanAccessTenant(tenantId: string, user: AuthUser): Promise<void> {
  if (user.systemRole === 'platform_admin') return
  if (user.tenantId !== tenantId) {
    throw new AppError(403, 'FORBIDDEN', '無法存取此租戶的預設樣板')
  }
}

async function ensureProjectFormTemplate(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'update' | 'delete'
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'construction.upload', action)
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function buildStorageKey(tenantId: string | null, projectId: string | null, fileName: string): string {
  const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  if (projectId) {
    const prefix = tenantId ? `${tenantId}/${projectId}/form-templates` : `_/${projectId}/form-templates`
    return `${prefix}/${uid}_${safe}`
  }
  const prefix = tenantId ? `${tenantId}/form-templates` : '_/form-templates'
  return `${prefix}/${uid}_${safe}`
}

export const formTemplateService = {
  /** 後台新增預設樣板（tenant_admin 本租戶；platform_admin 可指定 tenantId） */
  async createDefault(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    name: string,
    description: string | null,
    userId: string,
    user: AuthUser,
    tenantId: string
  ) {
    await ensureCanAccessTenant(tenantId, user)
    const fileSize = buffer.length
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, ...notDeleted } })
    const limitBytes = tenant?.fileSizeLimitMb != null ? tenant.fileSizeLimitMb * 1024 * 1024 : UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES
    if (fileSize > limitBytes) {
      throw new AppError(403, 'FILE_SIZE_EXCEEDED', `單一檔案不得超過 ${tenant?.fileSizeLimitMb ?? 50} MB`)
    }
    const fileHash = sha256(buffer)
    const storageKey = buildStorageKey(tenantId, null, fileName)
    await storage.upload(buffer, storageKey, mimeType)
    return formTemplateRepository.create({
      tenantId,
      projectId: null,
      name: name.trim() || fileName,
      description: description?.trim() || null,
      storageKey,
      fileName,
      fileSize,
      mimeType,
      fileHash,
      uploadedById: userId,
    })
  },

  /** 專案內新增樣板 */
  async createForProject(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    name: string,
    description: string | null,
    projectId: string,
    userId: string,
    user: AuthUser
  ) {
    await ensureProjectFormTemplate(projectId, user, 'create')
    const project = await projectRepository.findById(projectId)
    if (!project) throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    const tenantId = project.tenantId
    const fileSize = buffer.length
    const tenant = tenantId ? await prisma.tenant.findFirst({ where: { id: tenantId, ...notDeleted } }) : null
    const limitBytes = tenant?.fileSizeLimitMb != null ? tenant.fileSizeLimitMb * 1024 * 1024 : UPLOAD_MAX_FILE_SIZE_DEFAULT_BYTES
    if (fileSize > limitBytes) {
      throw new AppError(403, 'FILE_SIZE_EXCEEDED', `單一檔案不得超過 ${tenant?.fileSizeLimitMb ?? 50} MB`)
    }
    const fileHash = sha256(buffer)
    const storageKey = buildStorageKey(tenantId, projectId, fileName)
    await storage.upload(buffer, storageKey, mimeType)
    return formTemplateRepository.create({
      tenantId,
      projectId,
      name: name.trim() || fileName,
      description: description?.trim() || null,
      storageKey,
      fileName,
      fileSize,
      mimeType,
      fileHash,
      uploadedById: userId,
    })
  },

  /** 後台預設樣板列表 */
  async listDefaultByTenant(tenantId: string, user: AuthUser) {
    await ensureCanAccessTenant(tenantId, user)
    return formTemplateRepository.findDefaultByTenantId(tenantId)
  },

  /** 專案可見樣板（預設 + 專案自訂） */
  async listForProject(projectId: string, userId: string, user: AuthUser) {
    await ensureProjectFormTemplate(projectId, user, 'read')
    const project = await projectRepository.findById(projectId)
    if (!project) throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    return formTemplateRepository.findForProject(projectId, project.tenantId)
  },

  /** 取得單一筆（含 stream 供下載） */
  async getById(id: string, userId: string, user: AuthUser) {
    const row = await formTemplateRepository.findById(id)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該樣板')
    if (row.projectId) {
      await ensureProjectFormTemplate(row.projectId, user, 'read')
    } else if (row.tenantId) {
      await ensureCanAccessTenant(row.tenantId, user)
    }
    const { stream, contentType } = await storage.getStream(row.storageKey)
    return { ...row, stream, contentType: contentType ?? row.mimeType }
  },

  async update(id: string, data: { name?: string; description?: string | null }, user: AuthUser) {
    const row = await formTemplateRepository.findById(id)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該樣板')
    if (row.projectId) {
      await ensureProjectFormTemplate(row.projectId, user, 'update')
    } else if (row.tenantId) {
      await ensureCanAccessTenant(row.tenantId, user)
    }
    return formTemplateRepository.update(id, data)
  },

  async delete(id: string, userId: string, user: AuthUser) {
    const row = await formTemplateRepository.findById(id)
    if (!row) throw new AppError(404, 'NOT_FOUND', '找不到該樣板')
    if (row.projectId) {
      await ensureProjectFormTemplate(row.projectId, user, 'delete')
    } else if (row.tenantId) {
      await ensureCanAccessTenant(row.tenantId, user)
    }
    const deleted = await formTemplateRepository.delete(id, userId)
    if (deleted) await storage.delete(deleted.storageKey)
  },
}
