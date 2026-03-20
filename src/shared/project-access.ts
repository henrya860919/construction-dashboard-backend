import { prisma } from '../lib/db.js'
import { AppError } from './errors.js'
import { notDeleted } from './soft-delete.js'

export type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

/**
 * 是否可存取該專案（進入專案工作區／專案 API 前置檢查）。
 * - platform_admin：專案存在即可
 * - tenant_admin：專案須屬於同租戶（不要求 ProjectMember）
 * - project_user：須為 active 之 ProjectMember
 */
export async function assertCanAccessProject(user: AuthUser, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    select: { tenantId: true },
  })
  if (!project) {
    throw new AppError(404, 'NOT_FOUND', '找不到該專案')
  }
  if (user.systemRole === 'platform_admin') {
    return
  }
  if (user.systemRole === 'tenant_admin') {
    if (project.tenantId !== user.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '無權限存取此專案')
    }
    return
  }
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId: user.id, ...notDeleted },
    select: { status: true },
  })
  if (!member || member.status !== 'active') {
    throw new AppError(403, 'FORBIDDEN', '非專案成員或已停用，無法存取此專案')
  }
}
