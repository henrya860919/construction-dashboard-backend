import { AppError } from '../../shared/errors.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { albumRepository, type AlbumRecord } from './album.repository.js'
import { fileRepository, type AttachmentRecord } from '../file/file.repository.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensurePhoto(projectId: string, user: AuthUser, action: 'read' | 'create' | 'update' | 'delete'): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'construction.photo', action)
}

export type AlbumPhotoItem = AttachmentRecord & {
  uploaderName: string | null
}

export const albumService = {
  async listAlbums(projectId: string, userId: string, user: AuthUser): Promise<AlbumRecord[]> {
    await ensurePhoto(projectId, user, 'read')
    return albumRepository.findByProjectId(projectId)
  },

  async createAlbum(
    projectId: string,
    name: string,
    userId: string,
    user: AuthUser
  ): Promise<AlbumRecord> {
    await ensurePhoto(projectId, user, 'create')
    const trimmed = name.trim()
    if (!trimmed) {
      throw new AppError(400, 'VALIDATION_ERROR', '相簿名稱為必填')
    }
    return albumRepository.create(projectId, trimmed)
  },

  async deleteAlbum(
    albumId: string,
    userId: string,
    user: AuthUser
  ): Promise<void> {
    const album = await albumRepository.findById(albumId)
    if (!album) {
      throw new AppError(404, 'NOT_FOUND', '找不到該相簿')
    }
    await ensurePhoto(album.projectId, user, 'delete')
    await albumRepository.delete(albumId, userId)
  },

  async listAlbumPhotos(
    albumId: string,
    userId: string,
    user: AuthUser
  ): Promise<AlbumPhotoItem[]> {
    const album = await albumRepository.findById(albumId)
    if (!album) {
      throw new AppError(404, 'NOT_FOUND', '找不到該相簿')
    }
    await ensurePhoto(album.projectId, user, 'read')
    const attachmentIds = await albumRepository.getAttachmentIds(albumId)
    if (attachmentIds.length === 0) {
      return []
    }
    const { items } = await fileRepository.findManyByIds(attachmentIds)
    return items.map((row: AttachmentRecord & { uploadedBy?: { name: string | null } }) => ({
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
      uploaderName: row.uploadedBy?.name ?? null,
    }))
  },

  async addPhotoToAlbum(
    albumId: string,
    attachmentId: string,
    userId: string,
    user: AuthUser
  ): Promise<void> {
    const album = await albumRepository.findById(albumId)
    if (!album) {
      throw new AppError(404, 'NOT_FOUND', '找不到該相簿')
    }
    await ensurePhoto(album.projectId, user, 'create')
    const attachment = await fileRepository.findById(attachmentId)
    if (!attachment) {
      throw new AppError(404, 'NOT_FOUND', '找不到該檔案')
    }
    if (attachment.projectId !== album.projectId) {
      throw new AppError(400, 'BAD_REQUEST', '檔案必須屬於同一專案')
    }
    await albumRepository.addPhoto(albumId, attachmentId)
  },

  async removePhotoFromAlbum(
    albumId: string,
    attachmentId: string,
    userId: string,
    user: AuthUser
  ): Promise<void> {
    const album = await albumRepository.findById(albumId)
    if (!album) {
      throw new AppError(404, 'NOT_FOUND', '找不到該相簿')
    }
    await ensurePhoto(album.projectId, user, 'delete')
    await albumRepository.removePhoto(albumId, attachmentId)
  },
}
