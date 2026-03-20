import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import {
  assertTenantMayOperateProjectsAndPermissions,
  assertTenantModuleNotDisabled,
  clampPermissionRows,
  getEffectiveDisabledModuleIdsSet,
  maskModulesMap,
} from '../tenant-module-entitlement/tenant-module-entitlement.service.js'
import { assertCanAccessProject, type AuthUser } from '../../shared/project-access.js'
import {
  PERMISSION_MODULES,
  type PermissionModuleId,
  isPermissionModuleId,
} from '../../constants/permission-modules.js'
import { projectPermissionRepository, type PermissionRow } from './project-permission.repository.js'
import {
  defaultFlagsByProjectRole,
  PRESET_TEMPLATES,
  type ModuleFlags,
  type PresetKey,
} from './preset-roles.js'

export type PermissionAction = 'create' | 'read' | 'update' | 'delete'

export type ModulePermissionDto = {
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
}

function flagsToRow(module: PermissionModuleId, f: ModuleFlags): PermissionRow & { module: PermissionModuleId } {
  return {
    module,
    canCreate: f.canCreate,
    canRead: f.canRead,
    canUpdate: f.canUpdate,
    canDelete: f.canDelete,
  }
}

function recordToRows(record: Record<PermissionModuleId, ModuleFlags>): Array<
  PermissionRow & { module: PermissionModuleId }
> {
  return PERMISSION_MODULES.map((m) => flagsToRow(m, record[m]))
}

/** platform_admin／同租戶 tenant_admin 可編輯目標使用者之範本 */
export async function ensureCanManageUserPermissionTemplate(
  actor: AuthUser,
  targetUserId: string,
  tenantId: string
): Promise<void> {
  if (actor.systemRole === 'platform_admin') {
    const u = await prisma.user.findFirst({
      where: { id: targetUserId, ...notDeleted },
      select: { tenantId: true },
    })
    if (!u?.tenantId || u.tenantId !== tenantId) {
      throw new AppError(400, 'BAD_REQUEST', '使用者不屬於指定租戶')
    }
    return
  }
  if (actor.systemRole !== 'tenant_admin' || !actor.tenantId) {
    throw new AppError(403, 'FORBIDDEN', '僅租戶或平台管理員可管理權限範本')
  }
  if (actor.tenantId !== tenantId) {
    throw new AppError(403, 'FORBIDDEN', '僅能管理本租戶成員範本')
  }
  const u = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId, ...notDeleted },
    select: { id: true },
  })
  if (!u) {
    throw new AppError(404, 'NOT_FOUND', '找不到該租戶成員')
  }
  await assertTenantMayOperateProjectsAndPermissions(tenantId)
}

/** 超級使用者略過細粒度；project_user 依 project_member_permissions */
export function bypassesFineGrainedPermissions(user: AuthUser): boolean {
  return user.systemRole === 'platform_admin' || user.systemRole === 'tenant_admin'
}

function actionToFlag(row: PermissionRow | undefined, action: PermissionAction): boolean {
  if (!row) return false
  switch (action) {
    case 'create':
      return row.canCreate
    case 'read':
      return row.canRead
    case 'update':
      return row.canUpdate
    case 'delete':
      return row.canDelete
    default:
      return false
  }
}

function mapRowsToDto(rows: PermissionRow[]): Record<string, ModulePermissionDto> {
  const byMod = new Map(rows.map((r) => [r.module, r]))
  const out: Record<string, ModulePermissionDto> = {}
  for (const m of PERMISSION_MODULES) {
    const r = byMod.get(m)
    out[m] = r
      ? {
          canCreate: r.canCreate,
          canRead: r.canRead,
          canUpdate: r.canUpdate,
          canDelete: r.canDelete,
        }
      : { canCreate: false, canRead: false, canUpdate: false, canDelete: false }
  }
  return out
}

function normalizeProjectRole(role: string): 'project_admin' | 'member' | 'viewer' {
  if (role === 'project_admin' || role === 'member' || role === 'viewer') return role
  return 'member'
}

async function getProjectTenantIdOrThrow(projectId: string): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    select: { tenantId: true },
  })
  if (!project?.tenantId) {
    throw new AppError(400, 'BAD_REQUEST', '專案未綁定租戶')
  }
  return project.tenantId
}

/**
 * 與 syncProjectMemberPermissionsFromTemplate 相同邏輯（不寫入 DB）：用於比對是否為「專案客製」。
 */
export async function getExpectedProjectMemberPermissionsFromTemplate(
  tenantId: string,
  userId: string,
  role: 'project_admin' | 'member' | 'viewer'
): Promise<Record<string, ModulePermissionDto>> {
  const templates = await projectPermissionRepository.findTemplatesForUser(tenantId, userId)
  if (templates.length > 0) {
    const rows: Array<PermissionRow & { module: PermissionModuleId }> = []
    for (const t of templates) {
      if (!isPermissionModuleId(t.module)) continue
      rows.push({
        module: t.module,
        canCreate: t.canCreate,
        canRead: t.canRead,
        canUpdate: t.canUpdate,
        canDelete: t.canDelete,
      })
    }
    if (rows.length > 0) {
      const map = mapRowsToDto(rows)
      const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
      return maskModulesMap(map, disabled)
    }
  }
  const defaults = defaultFlagsByProjectRole(role)
  const map = mapRowsToDto(recordToRows(defaults))
  const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
  return maskModulesMap(map, disabled)
}

export type ProjectMemberPermissionsPayload = {
  modules: Record<string, ModulePermissionDto>
  baselineModules: Record<string, ModulePermissionDto>
}

/**
 * @param subjectUserId 權限所屬使用者
 * @param forceDb 管理員檢視／編輯他人時為 true，一律讀 DB
 */
export async function getModulesMapForUser(
  projectId: string,
  subjectUserId: string,
  actor: AuthUser,
  options?: { forceDb?: boolean }
): Promise<Record<string, ModulePermissionDto>> {
  await assertCanAccessProject(actor, projectId)
  const tenantId = await getProjectTenantIdOrThrow(projectId)
  const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
  const forceDb = options?.forceDb === true
  if (
    !forceDb &&
    bypassesFineGrainedPermissions(actor) &&
    subjectUserId === actor.id
  ) {
    const full: Record<string, ModulePermissionDto> = {}
    for (const m of PERMISSION_MODULES) {
      full[m] = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
    }
    if (actor.systemRole === 'platform_admin') {
      return full
    }
    return maskModulesMap(full, disabled)
  }
  const rows = await projectPermissionRepository.findProjectPermissions(projectId, subjectUserId)
  let map = mapRowsToDto(rows)
  if (actor.systemRole !== 'platform_admin') {
    map = maskModulesMap(map, disabled)
  }
  return map
}

/** 目前登入者於該專案之有效權限（my-permissions） */
export async function getMyPermissionsMap(
  projectId: string,
  actor: AuthUser
): Promise<Record<string, ModulePermissionDto>> {
  return getModulesMapForUser(projectId, actor.id, actor)
}

export async function assertProjectModuleAction(
  user: AuthUser,
  projectId: string,
  module: PermissionModuleId,
  action: PermissionAction
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  const tenantId = await getProjectTenantIdOrThrow(projectId)
  if (user.systemRole !== 'platform_admin') {
    await assertTenantModuleNotDisabled(tenantId, module)
  }
  if (bypassesFineGrainedPermissions(user)) {
    return
  }
  const rows = await projectPermissionRepository.findProjectPermissions(projectId, user.id)
  const row = rows.find((r) => r.module === module)
  if (!actionToFlag(row, action)) {
    throw new AppError(403, 'FORBIDDEN', '權限不足')
  }
}

/** 加入／還原專案成員後：自範本複製；範本無列則依 ProjectRole 預設 */
export async function syncProjectMemberPermissionsFromTemplate(
  projectId: string,
  userId: string,
  tenantId: string,
  role: 'project_admin' | 'member' | 'viewer'
): Promise<void> {
  const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
  const templates = await projectPermissionRepository.findTemplatesForUser(tenantId, userId)
  await projectPermissionRepository.deleteManyProjectUser(projectId, userId)
  if (templates.length > 0) {
    const rows: Array<PermissionRow & { module: PermissionModuleId }> = []
    for (const t of templates) {
      if (!isPermissionModuleId(t.module)) continue
      rows.push({
        module: t.module,
        canCreate: t.canCreate,
        canRead: t.canRead,
        canUpdate: t.canUpdate,
        canDelete: t.canDelete,
      })
    }
    if (rows.length > 0) {
      await projectPermissionRepository.createManyProjectPermissions(
        projectId,
        userId,
        clampPermissionRows(rows, disabled)
      )
      return
    }
  }
  const defaults = defaultFlagsByProjectRole(role)
  await projectPermissionRepository.createManyProjectPermissions(
    projectId,
    userId,
    clampPermissionRows(recordToRows(defaults), disabled)
  )
}

export async function listTenantTemplate(
  actor: AuthUser,
  tenantId: string,
  targetUserId: string
): Promise<Record<string, ModulePermissionDto>> {
  await ensureCanManageUserPermissionTemplate(actor, targetUserId, tenantId)
  const rows = await projectPermissionRepository.findTemplatesForUser(tenantId, targetUserId)
  const byMod = new Map(rows.map((r) => [r.module, r]))
  const out: Record<string, ModulePermissionDto> = {}
  for (const m of PERMISSION_MODULES) {
    const r = byMod.get(m)
    out[m] = r
      ? {
          canCreate: r.canCreate,
          canRead: r.canRead,
          canUpdate: r.canUpdate,
          canDelete: r.canDelete,
        }
      : { canCreate: false, canRead: false, canUpdate: false, canDelete: false }
  }
  if (actor.systemRole !== 'platform_admin') {
    const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
    return maskModulesMap(out, disabled)
  }
  return out
}

export async function replaceTenantTemplate(
  actor: AuthUser,
  tenantId: string,
  targetUserId: string,
  modules: Record<string, ModulePermissionDto>
): Promise<Record<string, ModulePermissionDto>> {
  await ensureCanManageUserPermissionTemplate(actor, targetUserId, tenantId)
  const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
  await projectPermissionRepository.deleteManyTemplates(tenantId, targetUserId)
  const rows: Array<PermissionRow & { module: PermissionModuleId }> = []
  for (const m of PERMISSION_MODULES) {
    const dto = modules[m]
    if (!dto) continue
    rows.push({
      module: m,
      canCreate: !!dto.canCreate,
      canRead: !!dto.canRead,
      canUpdate: !!dto.canUpdate,
      canDelete: !!dto.canDelete,
    })
  }
  const toWrite = clampPermissionRows(rows, disabled)
  if (toWrite.length > 0) {
    await projectPermissionRepository.createManyTemplates(tenantId, targetUserId, toWrite)
  }
  return listTenantTemplate(actor, tenantId, targetUserId)
}

export async function applyPresetToTenantTemplate(
  actor: AuthUser,
  tenantId: string,
  targetUserId: string,
  presetKey: PresetKey
): Promise<Record<string, ModulePermissionDto>> {
  const build = PRESET_TEMPLATES[presetKey]
  if (!build) {
    throw new AppError(400, 'BAD_REQUEST', '未知的 preset')
  }
  const record = build()
  await ensureCanManageUserPermissionTemplate(actor, targetUserId, tenantId)
  const disabled = await getEffectiveDisabledModuleIdsSet(tenantId)
  await projectPermissionRepository.deleteManyTemplates(tenantId, targetUserId)
  await projectPermissionRepository.createManyTemplates(
    tenantId,
    targetUserId,
    clampPermissionRows(recordToRows(record), disabled)
  )
  return listTenantTemplate(actor, tenantId, targetUserId)
}

/**
 * 專案內「成員模組權限覆寫」僅租戶管理員／平台管理員可為（不依 project.members 矩陣）。
 * 一般 project_user 即使具 project.members update 也不可改他人模組權限。
 */
async function assertProjectMemberPermissionOverridesManage(actor: AuthUser, projectId: string): Promise<void> {
  await assertCanAccessProject(actor, projectId)
  if (actor.systemRole === 'platform_admin') return
  if (actor.systemRole !== 'tenant_admin' || !actor.tenantId) {
    throw new AppError(403, 'FORBIDDEN', '僅租戶管理員或平台管理員可調整專案內成員模組權限')
  }
}

async function assertTenantAdminMayWriteProjectMemberOverrides(actor: AuthUser): Promise<void> {
  if (actor.systemRole === 'tenant_admin' && actor.tenantId) {
    await assertTenantMayOperateProjectsAndPermissions(actor.tenantId)
  }
}

/** 專案內覆寫成員權限（僅租戶／平台管理員） */
export async function listProjectMemberOverrides(
  actor: AuthUser,
  projectId: string,
  targetUserId: string
): Promise<ProjectMemberPermissionsPayload> {
  await assertProjectMemberPermissionOverridesManage(actor, projectId)
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId: targetUserId, ...notDeleted },
  })
  if (!member) {
    throw new AppError(404, 'NOT_FOUND', '該使用者不是此專案成員')
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    select: { tenantId: true },
  })
  if (!project?.tenantId) {
    throw new AppError(400, 'BAD_REQUEST', '專案未綁定租戶')
  }
  const role = normalizeProjectRole(member.role)
  const modules = await getModulesMapForUser(projectId, targetUserId, actor, { forceDb: true })
  const baselineModules = await getExpectedProjectMemberPermissionsFromTemplate(
    project.tenantId,
    targetUserId,
    role
  )
  return { modules, baselineModules }
}

export async function replaceProjectMemberOverrides(
  actor: AuthUser,
  projectId: string,
  targetUserId: string,
  modules: Record<string, ModulePermissionDto>
): Promise<ProjectMemberPermissionsPayload> {
  await assertProjectMemberPermissionOverridesManage(actor, projectId)
  await assertTenantAdminMayWriteProjectMemberOverrides(actor)
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId: targetUserId, ...notDeleted },
  })
  if (!member) {
    throw new AppError(404, 'NOT_FOUND', '該使用者不是此專案成員')
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    select: { tenantId: true },
  })
  if (!project?.tenantId) {
    throw new AppError(400, 'BAD_REQUEST', '專案未綁定租戶')
  }
  const role = normalizeProjectRole(member.role)
  const disabled = await getEffectiveDisabledModuleIdsSet(project.tenantId)
  await projectPermissionRepository.deleteManyProjectUser(projectId, targetUserId)
  const rows: Array<PermissionRow & { module: PermissionModuleId }> = []
  for (const m of PERMISSION_MODULES) {
    const dto = modules[m]
    if (!dto) continue
    rows.push({
      module: m,
      canCreate: !!dto.canCreate,
      canRead: !!dto.canRead,
      canUpdate: !!dto.canUpdate,
      canDelete: !!dto.canDelete,
    })
  }
  const toWrite = clampPermissionRows(rows, disabled)
  if (toWrite.length > 0) {
    await projectPermissionRepository.createManyProjectPermissions(projectId, targetUserId, toWrite)
  }
  const next = await getModulesMapForUser(projectId, targetUserId, actor, { forceDb: true })
  const baselineModules = await getExpectedProjectMemberPermissionsFromTemplate(
    project.tenantId,
    targetUserId,
    role
  )
  return { modules: next, baselineModules }
}

export async function resetProjectMemberToTemplate(
  actor: AuthUser,
  projectId: string,
  targetUserId: string
): Promise<ProjectMemberPermissionsPayload> {
  await assertProjectMemberPermissionOverridesManage(actor, projectId)
  await assertTenantAdminMayWriteProjectMemberOverrides(actor)
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId: targetUserId, ...notDeleted },
    select: { role: true },
  })
  if (!member) {
    throw new AppError(404, 'NOT_FOUND', '該使用者不是此專案成員')
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...notDeleted },
    select: { tenantId: true },
  })
  if (!project?.tenantId) {
    throw new AppError(400, 'BAD_REQUEST', '專案未綁定租戶')
  }
  const role = normalizeProjectRole(member.role)
  await syncProjectMemberPermissionsFromTemplate(projectId, targetUserId, project.tenantId, role)
  const modules = await getModulesMapForUser(projectId, targetUserId, actor, { forceDb: true })
  const baselineModules = await getExpectedProjectMemberPermissionsFromTemplate(
    project.tenantId,
    targetUserId,
    role
  )
  return { modules, baselineModules }
}
