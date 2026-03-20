import type { Request, Response } from 'express'
import { AppError } from '../../shared/errors.js'
import { getCurrentAlerts, getAlertHistory } from './alerts.service.js'

type AlertsAuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

export const alertsController = {
  /** GET /alerts/current — 即時警報（目前回傳假資料，之後接 CWA） */
  async current(req: Request, res: Response) {
    const user = req.user as AlertsAuthUser
    if (!user?.id) {
      throw new AppError(401, 'UNAUTHORIZED', '未登入')
    }
    const projectId = (req.query.projectId as string) || undefined
    const data = await getCurrentAlerts(projectId, user)
    res.status(200).json({ data })
  },

  /** GET /alerts/history — 歷史警報（從 DB 查詢） */
  async history(req: Request, res: Response) {
    const user = req.user as AlertsAuthUser
    if (!user?.id) {
      throw new AppError(401, 'UNAUTHORIZED', '未登入')
    }
    const projectId = (req.query.projectId as string) || undefined
    const startDate = req.query.startDate as string
    const endDate = req.query.endDate as string
    const limit = req.query.limit != null ? Number(req.query.limit) : 100
    if (!startDate || !endDate) {
      throw new AppError(400, 'VALIDATION_ERROR', 'startDate 與 endDate 為必填')
    }
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', 'startDate、endDate 須為有效日期')
    }
    const data = await getAlertHistory({ projectId, user, startDate: start, endDate: end, limit })
    res.status(200).json({ data })
  },
}
