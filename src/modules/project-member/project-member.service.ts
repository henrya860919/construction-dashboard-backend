import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { projectMemberRepository, type ProjectMemberItem } from './project-member.repository.js'
import { projectRepository } from '../project/project.repository.js'
import type { AddProjectMemberBody } from '../../schemas/project-member.js'
import { projectPermissionRepository } from '../project-permission/project-permission.repository.js'
import {
  assertProjectModuleAction,
  syncProjectMemberPermissionsFromTemplate,
} from '../project-permission/project-permission.service.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

export const projectMemberService = {
  async list(projectId: string, user: AuthUser): Promise<ProjectMemberItem[]> {
    await assertProjectModuleAction(user, projectId, 'project.members', 'read')
    return projectMemberRepository.findManyByProjectId(projectId)
  },

  async listAvailable(projectId: string, user: AuthUser, limit = 100): Promise<{ id: string; email: string; name: string | null }[]> {
    await assertProjectModuleAction(user, projectId, 'project.members', 'create')
    const project = await projectRepository.findById(projectId)
    if (!project) throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    if (!project.tenantId) {
      throw new AppError(400, 'BAD_REQUEST', '此專案未綁定租戶，無法從租戶成員加入')
    }
    return projectMemberRepository.findTenantUsersNotInProject(projectId, project.tenantId, limit)
  },

  async add(projectId: string, data: AddProjectMemberBody, user: AuthUser): Promise<ProjectMemberItem> {
    await assertProjectModuleAction(user, projectId, 'project.members', 'create')
    const project = await projectRepository.findById(projectId)
    if (!project) throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    if (!project.tenantId) {
      throw new AppError(400, 'BAD_REQUEST', '此專案未綁定租戶，無法加入成員')
    }
    const targetUser = await prisma.user.findFirst({
      where: { id: data.userId, ...notDeleted },
      select: { id: true, tenantId: true, status: true },
    })
    if (!targetUser) throw new AppError(404, 'NOT_FOUND', '找不到該使用者')
    if (targetUser.tenantId !== project.tenantId) {
      throw new AppError(400, 'BAD_REQUEST', '僅能加入同租戶的成員')
    }
    if (targetUser.status !== 'active') {
      throw new AppError(400, 'BAD_REQUEST', '僅能加入使用中的成員')
    }
    const exists = await projectMemberRepository.exists(projectId, data.userId)
    if (exists) throw new AppError(409, 'CONFLICT', '該成員已在專案中')
    let createdRole: 'project_admin' | 'member' | 'viewer' = 'member'
    try {
      const row = await projectMemberRepository.create(projectId, data.userId, 'member')
      createdRole = row.role
    } catch (e) {
      if (e instanceof Error && e.message === 'PROJECT_MEMBER_ALREADY_ACTIVE') {
        throw new AppError(409, 'CONFLICT', '該成員已在專案中')
      }
      throw e
    }
    await syncProjectMemberPermissionsFromTemplate(projectId, data.userId, project.tenantId, createdRole)
    const list = await projectMemberRepository.findManyByProjectId(projectId)
    const added = list.find((m) => m.userId === data.userId)
    if (!added) throw new AppError(500, 'INTERNAL_ERROR', '新增後無法取得成員資料')
    return added
  },

  async remove(projectId: string, userId: string, user: AuthUser): Promise<void> {
    await assertProjectModuleAction(user, projectId, 'project.members', 'delete')
    const exists = await projectMemberRepository.exists(projectId, userId)
    if (!exists) throw new AppError(404, 'NOT_FOUND', '該使用者不是此專案成員')
    await projectPermissionRepository.deleteManyProjectUser(projectId, userId)
    await projectMemberRepository.deleteByProjectAndUser(projectId, userId, user.id)
  },

  async setStatus(
    projectId: string,
    userId: string,
    status: 'active' | 'suspended',
    user: AuthUser
  ): Promise<ProjectMemberItem> {
    await assertProjectModuleAction(user, projectId, 'project.members', 'update')
    const exists = await projectMemberRepository.exists(projectId, userId)
    if (!exists) throw new AppError(404, 'NOT_FOUND', '該使用者不是此專案成員')
    const updated = await projectMemberRepository.updateStatus(projectId, userId, status)
    if (!updated) throw new AppError(500, 'INTERNAL_ERROR', '更新狀態失敗')
    return updated
  },
}
