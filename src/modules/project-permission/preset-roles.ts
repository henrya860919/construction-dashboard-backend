import type { PermissionModuleId } from '../../constants/permission-modules.js'
import { PERMISSION_MODULES } from '../../constants/permission-modules.js'

export type ModuleFlags = {
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
}

export type PresetKey = 'site_supervisor' | 'equipment_manager' | 'owner_viewer' | 'project_engineer'

function allReadOnly(): Record<PermissionModuleId, ModuleFlags> {
  const out = {} as Record<PermissionModuleId, ModuleFlags>
  for (const m of PERMISSION_MODULES) {
    out[m] = { canCreate: false, canRead: true, canUpdate: false, canDelete: false }
  }
  return out
}

function allFull(): Record<PermissionModuleId, ModuleFlags> {
  const out = {} as Record<PermissionModuleId, ModuleFlags>
  for (const m of PERMISSION_MODULES) {
    out[m] = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
  }
  return out
}

/** 依 ProjectRole 產生預設專案權限（範本為空或還原時使用） */
export function defaultFlagsByProjectRole(
  role: 'project_admin' | 'member' | 'viewer'
): Record<PermissionModuleId, ModuleFlags> {
  if (role === 'project_admin') {
    return allFull()
  }
  return allReadOnly()
}

/** 後台一鍵套用 preset → 寫入租戶範本 */
export const PRESET_TEMPLATES: Record<
  PresetKey,
  () => Record<PermissionModuleId, ModuleFlags>
> = {
  owner_viewer: () => allReadOnly(),
  project_engineer: () => allFull(),
  site_supervisor: () => {
    const base = allReadOnly()
    const full = ['construction.inspection', 'construction.defect', 'construction.diary', 'construction.photo'] as const
    for (const m of full) {
      base[m] = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
    }
    return base
  },
  equipment_manager: () => {
    const base = allReadOnly()
    for (const m of ['construction.equipment', 'repair.record', 'repair.overview'] as const) {
      base[m] = { canCreate: true, canRead: true, canUpdate: true, canDelete: true }
    }
    return base
  },
}
