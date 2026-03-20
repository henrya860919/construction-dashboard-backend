import type { AlertLevel } from '../../types/alerts.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { alertsRepository } from './alerts.repository.js'

type AlertsAuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

export type AlertItemDto = {
  id: string
  level: AlertLevel
  title: string
  value: string
  description?: string
  /** 最後一次發生時間（ISO 字串），前端用於顯示「已過 X 分鐘」 */
  lastSeenAt: string
}

/** 即時警報假資料（六類），之後改為呼叫 CWA */
const MOCK_ALERTS: Array<{ alertType: string; level: AlertLevel; title: string; value: string }> = [
  { alertType: '地震', level: 'attention', title: '地震', value: '規模 4.5 · 宜蘭外海' },
  { alertType: '豪雨', level: 'alarm', title: '豪雨', value: '大台北地區 大雨特報' },
  { alertType: '高溫', level: 'alarm', title: '高溫', value: '36°C 橙色燈號' },
  { alertType: '颱風', level: 'attention', title: '颱風', value: '海上颱風警報' },
  { alertType: '空污', level: 'attention', title: '空污', value: 'PM2.5 偏高 敏感族群注意' },
  { alertType: '其他', level: 'normal', title: '其他', value: '強風 沿海空曠地區' },
]

const SYNC_THROTTLE_MS = 30_000 // 至少間隔 30 秒才再寫入，避免每次請求都寫
let lastSyncAt = 0

/**
 * 取得目前有效警報（30 分鐘內有發生的才顯示）。
 * 會先從政府資料（目前為假資料）同步到 DB，再回傳 lastSeenAt 在 30 分鐘內的紀錄。
 */
export async function getCurrentAlerts(projectId: string | null | undefined, user: AlertsAuthUser): Promise<AlertItemDto[]> {
  const now = Date.now()
  const projId = projectId ?? null

  if (projId) {
    await assertCanAccessProject(user, projId)
    await assertProjectModuleAction(user, projId, 'construction.monitor', 'read')
  }

  if (now - lastSyncAt >= SYNC_THROTTLE_MS) {
    lastSyncAt = now
    for (const a of MOCK_ALERTS) {
      await alertsRepository.upsertCurrent({
        projectId: projId,
        alertType: a.alertType,
        level: a.level,
        title: a.title,
        value: a.value,
        source: 'mock',
      })
      await alertsRepository.insertHistory({
        projectId: projId,
        alertType: a.alertType,
        level: a.level,
        title: a.title,
        value: a.value,
        source: 'mock',
      })
    }
  }

  const rows = await alertsRepository.findCurrentWithinMinutes(projId, 30)
  return rows.map((r) => ({
    id: r.id,
    level: r.level as AlertLevel,
    title: r.title,
    value: r.value,
    description: r.description ?? undefined,
    lastSeenAt: r.lastSeenAt.toISOString(),
  }))
}

/**
 * 歷史警報（從 alert_history_records 查詢）
 */
export async function getAlertHistory(params: {
  projectId?: string | null
  user: AlertsAuthUser
  startDate: Date
  endDate: Date
  limit?: number
}): Promise<Array<AlertItemDto & { createdAt: string }>> {
  const projId = params.projectId ?? null
  if (projId) {
    await assertCanAccessProject(params.user, projId)
    await assertProjectModuleAction(params.user, projId, 'construction.monitor', 'read')
  }
  const rows = await alertsRepository.findHistoryByDateRange({
    projectId: projId,
    startDate: params.startDate,
    endDate: params.endDate,
    limit: params.limit,
  })
  return rows.map((r) => ({
    id: r.id,
    level: r.level as AlertLevel,
    title: r.title,
    value: r.value,
    description: r.description ?? undefined,
    lastSeenAt: r.createdAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }))
}
