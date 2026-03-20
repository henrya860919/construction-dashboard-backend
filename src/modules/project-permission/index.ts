export {
  assertProjectModuleAction,
  syncProjectMemberPermissionsFromTemplate,
  getMyPermissionsMap,
  type PermissionAction,
} from './project-permission.service.js'
export { assertCanAccessProject, type AuthUser } from '../../shared/project-access.js'
export type { PermissionModuleId } from '../../constants/permission-modules.js'
export { PERMISSION_MODULES } from '../../constants/permission-modules.js'
