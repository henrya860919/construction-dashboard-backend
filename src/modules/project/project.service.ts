import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { assertTenantMayOperateProjectsAndPermissions } from '../tenant-module-entitlement/tenant-module-entitlement.service.js'
import { projectRepository, type ProjectListItem } from './project.repository.js'
import type { CreateProjectBody, UpdateProjectBody } from '../../schemas/project.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

function parseDate(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 開工日 + 天數 → 該日 23:59:59 同日（僅日期部分加天數） */
function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

/** 取得專案已核定工期調整天數總和（僅 status=approved） */
async function getSumApprovedDays(projectId: string): Promise<number> {
  const r = await prisma.projectScheduleAdjustment.aggregate({
    where: { projectId, status: 'approved', ...notDeleted },
    _sum: { approvedDays: true },
  })
  return r._sum?.approvedDays ?? 0
}

/** 僅依開工+工期計算 plannedEndDate（用於 list，不查 adjustments） */
function applyPlannedEndFromDuration(project: ProjectListItem): ProjectListItem {
  const start = project.startDate
  const duration = project.plannedDurationDays ?? 0
  const plannedEnd = start && duration > 0 ? addDays(start, duration) : project.plannedEndDate
  return { ...project, plannedEndDate: plannedEnd ?? project.plannedEndDate }
}

/** 依開工+工期+調整工期計算並寫回 plannedEndDate / revisedEndDate（不寫入 DB，僅回傳用） */
function applyComputedDates(project: ProjectListItem, sumApprovedDays: number): ProjectListItem {
  const start = project.startDate
  const duration = project.plannedDurationDays ?? 0
  const plannedEnd = start && duration > 0 ? addDays(start, duration) : project.plannedEndDate
  const totalDays = duration + sumApprovedDays
  const revisedEnd = start && totalDays > 0 ? addDays(start, totalDays) : plannedEnd ?? null
  return {
    ...project,
    plannedEndDate: plannedEnd ?? project.plannedEndDate,
    revisedEndDate: revisedEnd ?? project.revisedEndDate,
  }
}

export const projectService = {
  async list(
    args: { page: number; limit: number; skip: number },
    user: AuthUser
  ): Promise<{ list: ProjectListItem[]; total: number }> {
    if (user.systemRole === 'platform_admin') {
      const [rows, total] = await Promise.all([
        projectRepository.findMany({
          skip: args.skip,
          take: args.limit,
          tenantId: undefined,
        }),
        projectRepository.count(undefined),
      ])
      return { list: rows.map(applyPlannedEndFromDuration), total }
    }
    if (user.systemRole === 'tenant_admin') {
      if (user.tenantId == null) return { list: [], total: 0 }
      const [rows, total] = await Promise.all([
        projectRepository.findMany({
          skip: args.skip,
          take: args.limit,
          tenantId: user.tenantId,
        }),
        projectRepository.count(user.tenantId),
      ])
      return { list: rows.map(applyPlannedEndFromDuration), total }
    }
    // project_user：僅顯示身為專案成員（ProjectMember）的專案
    const [rows, total] = await Promise.all([
      projectRepository.findManyByMemberUserId({
        userId: user.id,
        skip: args.skip,
        take: args.limit,
      }),
      projectRepository.countByMemberUserId(user.id),
    ])
    return { list: rows.map(applyPlannedEndFromDuration), total }
  },

  async getById(id: string, user: AuthUser): Promise<ProjectListItem> {
    const project = await projectRepository.findById(id)
    if (!project) {
      throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    }
    await assertCanAccessProject(user, id)
    if (user.systemRole === 'project_user') {
      await assertProjectModuleAction(user, id, 'project.overview', 'read')
    }
    const sumApprovedDays = await getSumApprovedDays(id)
    return applyComputedDates(project, sumApprovedDays)
  },

  async create(data: CreateProjectBody, user: AuthUser): Promise<ProjectListItem> {
    if (user.systemRole === 'project_user') {
      throw new AppError(403, 'FORBIDDEN', '僅管理員可新增專案')
    }
    const tenantId =
      user.systemRole === 'tenant_admin'
        ? user.tenantId
        : (data.tenantId ?? null)
    if (user.systemRole === 'tenant_admin' && !tenantId) {
      throw new AppError(400, 'BAD_REQUEST', '租戶管理員所屬租戶不明')
    }
    if (tenantId) {
      await assertTenantMayOperateProjectsAndPermissions(tenantId)
    }
    const project = await projectRepository.create({
      name: data.name,
      description: data.description ?? null,
      code: data.code ?? null,
      status: data.status ?? 'active',
      tenantId,
    })
    try {
      await prisma.wbsNode.create({
        data: {
          id: `wbs-root-${project.id}`,
          projectId: project.id,
          parentId: null,
          code: '1',
          name: project.name,
          sortOrder: 0,
          isProjectRoot: true,
        },
      })
    } catch {
      // 並發或已存在根節點時略過
    }
    return project
  },

  async update(id: string, data: UpdateProjectBody, user: AuthUser): Promise<ProjectListItem> {
    const project = await projectRepository.findById(id)
    if (!project) {
      throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    }
    await assertCanAccessProject(user, id)
    if (user.systemRole === 'project_user') {
      await assertProjectModuleAction(user, id, 'project.overview', 'update')
    } else if (user.systemRole !== 'platform_admin' && project.tenantId !== user.tenantId) {
      throw new AppError(403, 'FORBIDDEN', '無權限編輯此專案')
    }
    const payload: Parameters<typeof projectRepository.update>[1] = {}
    if (data.name !== undefined) payload.name = data.name
    if (data.description !== undefined) payload.description = data.description ?? null
    if (data.code !== undefined) payload.code = data.code ?? null
    if (data.status !== undefined) payload.status = data.status
    if (data.designUnit !== undefined) payload.designUnit = data.designUnit ?? null
    if (data.supervisionUnit !== undefined) payload.supervisionUnit = data.supervisionUnit ?? null
    if (data.contractor !== undefined) payload.contractor = data.contractor ?? null
    if (data.summary !== undefined) payload.summary = data.summary ?? null
    if (data.benefits !== undefined) payload.benefits = data.benefits ?? null
    if (data.startDate !== undefined) payload.startDate = parseDate(data.startDate)
    if (data.plannedDurationDays !== undefined) payload.plannedDurationDays = data.plannedDurationDays
    if (data.plannedEndDate !== undefined) payload.plannedEndDate = parseDate(data.plannedEndDate)
    if (data.revisedEndDate !== undefined) payload.revisedEndDate = parseDate(data.revisedEndDate)
    if (data.siteManager !== undefined) payload.siteManager = data.siteManager ?? null
    if (data.contactPhone !== undefined) payload.contactPhone = data.contactPhone ?? null
    if (data.projectStaff !== undefined) payload.projectStaff = data.projectStaff ?? null
    const updated = await projectRepository.update(id, payload)
    const sumApprovedDays = await getSumApprovedDays(id)
    return applyComputedDates(updated, sumApprovedDays)
  },
}
