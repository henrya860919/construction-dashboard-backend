import { prisma } from '../../lib/db.js'
import { AppError } from '../../shared/errors.js'
import { notDeleted } from '../../shared/soft-delete.js'
import {
  PERMISSION_MODULES,
  type PermissionModuleId,
  isPermissionModuleId,
} from '../../constants/permission-modules.js'
import type { PermissionRow } from '../project-permission/project-permission.repository.js'

const ALL_FALSE = {
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
} as const

/** 僅 DB 列出的關閉模組（不含「尚未由平台儲存過開通設定」語意） */
export async function findDisabledModuleIdsSet(tenantId: string): Promise<Set<PermissionModuleId>> {
  const rows = await prisma.tenantModuleDisable.findMany({
    where: { tenantId },
    select: { module: true },
  })
  const set = new Set<PermissionModuleId>()
  for (const r of rows) {
    if (isPermissionModuleId(r.module)) set.add(r.module)
  }
  return set
}

/**
 * 租戶端權限／遮罩用：平台尚未儲存模組開通時視為「全部關閉」。
 */
export async function getEffectiveDisabledModuleIdsSet(tenantId: string): Promise<Set<PermissionModuleId>> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, ...notDeleted },
    select: { moduleEntitlementsGranted: true },
  })
  if (!tenant?.moduleEntitlementsGranted) {
    return new Set(PERMISSION_MODULES)
  }
  return findDisabledModuleIdsSet(tenantId)
}

export function maskModulesMap<T extends Record<string, { canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean }>>(
  map: T,
  disabled: Set<PermissionModuleId>
): T {
  if (disabled.size === 0) return map
  const out = { ...map } as T
  for (const m of disabled) {
    ;(out as Record<string, typeof ALL_FALSE>)[m] = { ...ALL_FALSE }
  }
  return out
}

export function clampPermissionRows(
  rows: Array<PermissionRow & { module: PermissionModuleId }>,
  disabled: Set<PermissionModuleId>
): Array<PermissionRow & { module: PermissionModuleId }> {
  if (disabled.size === 0) return rows
  return rows.map((r) =>
    disabled.has(r.module)
      ? {
          ...r,
          canCreate: false,
          canRead: false,
          canUpdate: false,
          canDelete: false,
        }
      : r
  )
}

export async function assertTenantModuleNotDisabled(tenantId: string, module: PermissionModuleId): Promise<void> {
  const effective = await getEffectiveDisabledModuleIdsSet(tenantId)
  if (effective.has(module)) {
    throw new AppError(403, 'MODULE_NOT_ENTITLED', '此租戶未開通此功能模組')
  }
}

export async function listDisabledModuleIdsSorted(tenantId: string): Promise<PermissionModuleId[]> {
  const set = await findDisabledModuleIdsSet(tenantId)
  return [...set].sort()
}

export async function getTenantModuleEntitlementsReadDto(tenantId: string): Promise<{
  moduleEntitlementsGranted: boolean
  disabledModuleIds: PermissionModuleId[]
}> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, ...notDeleted },
    select: { moduleEntitlementsGranted: true },
  })
  if (!tenant) {
    throw new AppError(404, 'NOT_FOUND', '找不到該租戶')
  }
  const disabledModuleIds = await listDisabledModuleIdsSorted(tenantId)
  return { moduleEntitlementsGranted: tenant.moduleEntitlementsGranted, disabledModuleIds }
}

/**
 * 租戶管理員：須平台已儲存模組開通，且不可「全部模組關閉」，才能新增專案或編輯成員／範本權限。
 * 平台管理員不呼叫此函式（另依情境略過）。
 */
export async function assertTenantMayOperateProjectsAndPermissions(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, ...notDeleted },
    select: { moduleEntitlementsGranted: true },
  })
  if (!tenant) {
    throw new AppError(404, 'NOT_FOUND', '找不到租戶')
  }
  if (!tenant.moduleEntitlementsGranted) {
    throw new AppError(
      403,
      'TENANT_MODULES_NOT_GRANTED',
      '平台尚未為此租戶開通功能模組，請待平台於租戶管理儲存「模組開通」後再操作'
    )
  }
  const disabled = await findDisabledModuleIdsSet(tenantId)
  if (disabled.size >= PERMISSION_MODULES.length) {
    throw new AppError(
      403,
      'TENANT_MODULES_ALL_DISABLED',
      '此租戶所有功能模組均已關閉，請至少開通一項模組後再新增專案或調整權限'
    )
  }
}

export async function replaceTenantModuleDisables(
  tenantId: string,
  disabledModuleIds: PermissionModuleId[]
): Promise<PermissionModuleId[]> {
  const uniq = [...new Set(disabledModuleIds)]
  for (const m of uniq) {
    if (!PERMISSION_MODULES.includes(m)) {
      throw new AppError(400, 'BAD_REQUEST', '無效的模組 id')
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.tenantModuleDisable.deleteMany({ where: { tenantId } })
    if (uniq.length > 0) {
      await tx.tenantModuleDisable.createMany({
        data: uniq.map((module) => ({ tenantId, module })),
      })
    }
    await tx.tenant.update({
      where: { id: tenantId },
      data: { moduleEntitlementsGranted: true },
    })
  })
  return listDisabledModuleIdsSorted(tenantId)
}
