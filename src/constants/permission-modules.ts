/**
 * 功能模組 id（租戶範本／專案成員權限）；與前端 `permission-modules` 對齊。
 */
export const PERMISSION_MODULES = [
  'project.overview',
  'project.members',
  'project.wbs',
  'project.gantt',
  'project.resource',
  'project.schedule',
  'project.risk',
  'project.duration',
  'project.drawings',
  'construction.monitor',
  'construction.upload',
  'construction.equipment',
  'construction.inspection',
  'construction.diary',
  /** PCCES／eTender XML 匯入與工項版本（施工日誌前置資料） */
  'construction.pcces',
  'construction.defect',
  'construction.photo',
  'repair.overview',
  'repair.record',
] as const

export type PermissionModuleId = (typeof PERMISSION_MODULES)[number]

export function isPermissionModuleId(s: string): s is PermissionModuleId {
  return (PERMISSION_MODULES as readonly string[]).includes(s)
}
