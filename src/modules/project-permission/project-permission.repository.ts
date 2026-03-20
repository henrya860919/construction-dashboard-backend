import { prisma } from '../../lib/db.js'
import type { PermissionModuleId } from '../../constants/permission-modules.js'

export type PermissionRow = {
  module: string
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
}

export const projectPermissionRepository = {
  async findTemplatesForUser(tenantId: string, userId: string): Promise<PermissionRow[]> {
    const rows = await prisma.tenantPermissionTemplate.findMany({
      where: { tenantId, userId },
      select: {
        module: true,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      },
    })
    return rows
  },

  async findProjectPermissions(projectId: string, userId: string): Promise<PermissionRow[]> {
    return prisma.projectMemberPermission.findMany({
      where: { projectId, userId },
      select: {
        module: true,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
      },
    })
  },

  async deleteManyProjectUser(projectId: string, userId: string): Promise<void> {
    await prisma.projectMemberPermission.deleteMany({ where: { projectId, userId } })
  },

  async deleteManyTemplates(tenantId: string, userId: string): Promise<void> {
    await prisma.tenantPermissionTemplate.deleteMany({ where: { tenantId, userId } })
  },

  async upsertTemplates(
    tenantId: string,
    userId: string,
    rows: Array<PermissionRow & { module: PermissionModuleId }>
  ): Promise<void> {
    for (const r of rows) {
      await prisma.tenantPermissionTemplate.upsert({
        where: {
          tenantId_userId_module: { tenantId, userId, module: r.module },
        },
        create: {
          tenantId,
          userId,
          module: r.module,
          canCreate: r.canCreate,
          canRead: r.canRead,
          canUpdate: r.canUpdate,
          canDelete: r.canDelete,
        },
        update: {
          canCreate: r.canCreate,
          canRead: r.canRead,
          canUpdate: r.canUpdate,
          canDelete: r.canDelete,
        },
      })
    }
  },

  async upsertProjectPermissions(
    projectId: string,
    userId: string,
    rows: Array<PermissionRow & { module: PermissionModuleId }>
  ): Promise<void> {
    for (const r of rows) {
      await prisma.projectMemberPermission.upsert({
        where: {
          projectId_userId_module: { projectId, userId, module: r.module },
        },
        create: {
          projectId,
          userId,
          module: r.module,
          canCreate: r.canCreate,
          canRead: r.canRead,
          canUpdate: r.canUpdate,
          canDelete: r.canDelete,
        },
        update: {
          canCreate: r.canCreate,
          canRead: r.canRead,
          canUpdate: r.canUpdate,
          canDelete: r.canDelete,
        },
      })
    }
  },

  async createManyProjectPermissions(
    projectId: string,
    userId: string,
    rows: Array<PermissionRow & { module: PermissionModuleId }>
  ): Promise<void> {
    if (rows.length === 0) return
    await prisma.projectMemberPermission.createMany({
      data: rows.map((r) => ({
        projectId,
        userId,
        module: r.module,
        canCreate: r.canCreate,
        canRead: r.canRead,
        canUpdate: r.canUpdate,
        canDelete: r.canDelete,
      })),
    })
  },

  async createManyTemplates(
    tenantId: string,
    userId: string,
    rows: Array<PermissionRow & { module: PermissionModuleId }>
  ): Promise<void> {
    if (rows.length === 0) return
    await prisma.tenantPermissionTemplate.createMany({
      data: rows.map((r) => ({
        tenantId,
        userId,
        module: r.module,
        canCreate: r.canCreate,
        canRead: r.canRead,
        canUpdate: r.canUpdate,
        canDelete: r.canDelete,
      })),
    })
  },
}
