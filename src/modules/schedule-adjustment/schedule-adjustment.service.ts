import { AppError } from '../../shared/errors.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { scheduleAdjustmentRepository, type ScheduleAdjustmentItem } from './schedule-adjustment.repository.js'
import type { CreateScheduleAdjustmentBody, UpdateScheduleAdjustmentBody } from '../../schemas/scheduleAdjustment.js'

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

async function ensureDuration(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'update' | 'delete'
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'project.duration', action)
}

export const scheduleAdjustmentService = {
  async list(projectId: string, user: AuthUser): Promise<ScheduleAdjustmentItem[]> {
    await ensureDuration(projectId, user, 'read')
    return scheduleAdjustmentRepository.findManyByProjectId(projectId)
  },

  async create(projectId: string, data: CreateScheduleAdjustmentBody, user: AuthUser): Promise<ScheduleAdjustmentItem> {
    await ensureDuration(projectId, user, 'create')
    const applyDate = parseDate(data.applyDate)
    if (!applyDate) {
      throw new AppError(400, 'VALIDATION_ERROR', '申請日期格式錯誤')
    }
    return scheduleAdjustmentRepository.create({
      projectId,
      applyDate,
      type: data.type,
      applyDays: data.applyDays,
      approvedDays: data.approvedDays,
      status: data.status ?? 'pending',
    })
  },

  async update(
    projectId: string,
    id: string,
    data: UpdateScheduleAdjustmentBody,
    user: AuthUser
  ): Promise<ScheduleAdjustmentItem> {
    await ensureDuration(projectId, user, 'update')
    const existing = await scheduleAdjustmentRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該筆工期調整')
    }
    const payload: Parameters<typeof scheduleAdjustmentRepository.update>[1] = {}
    if (data.applyDate !== undefined) {
      const d = parseDate(data.applyDate)
      if (data.applyDate !== '' && !d) throw new AppError(400, 'VALIDATION_ERROR', '申請日期格式錯誤')
      payload.applyDate = d ?? existing.applyDate
    }
    if (data.type !== undefined) payload.type = data.type
    if (data.applyDays !== undefined) payload.applyDays = data.applyDays
    if (data.approvedDays !== undefined) payload.approvedDays = data.approvedDays
    if (data.status !== undefined) payload.status = data.status
    return scheduleAdjustmentRepository.update(id, payload)
  },

  async delete(projectId: string, id: string, user: AuthUser): Promise<void> {
    await ensureDuration(projectId, user, 'delete')
    const existing = await scheduleAdjustmentRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該筆工期調整')
    }
    await scheduleAdjustmentRepository.delete(id, user.id)
  },
}
