import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { defectImprovementController } from '../modules/defect-improvement/index.js'

export const defectImprovementsRouter = Router({ mergeParams: true })

/** GET /api/v1/projects/:projectId/defect-improvements — 缺失改善列表（可 ?status=in_progress|completed） */
defectImprovementsRouter.get('/', asyncHandler(defectImprovementController.list.bind(defectImprovementController)))

/** POST /api/v1/projects/:projectId/defect-improvements — 新增缺失改善 */
defectImprovementsRouter.post('/', asyncHandler(defectImprovementController.create.bind(defectImprovementController)))

/** GET /api/v1/projects/:projectId/defect-improvements/:id/records — 執行紀錄列表（須在 /:id 前） */
defectImprovementsRouter.get('/:id/records', asyncHandler(defectImprovementController.listRecords.bind(defectImprovementController)))

/** POST /api/v1/projects/:projectId/defect-improvements/:id/records — 新增執行紀錄 */
defectImprovementsRouter.post('/:id/records', asyncHandler(defectImprovementController.createRecord.bind(defectImprovementController)))

/** GET /api/v1/projects/:projectId/defect-improvements/:id/records/:recordId — 單一執行紀錄（含照片） */
defectImprovementsRouter.get('/:id/records/:recordId', asyncHandler(defectImprovementController.getRecord.bind(defectImprovementController)))

/** GET /api/v1/projects/:projectId/defect-improvements/:id — 單一缺失（含照片） */
defectImprovementsRouter.get('/:id', asyncHandler(defectImprovementController.getById.bind(defectImprovementController)))

/** PATCH /api/v1/projects/:projectId/defect-improvements/:id — 更新缺失改善 */
defectImprovementsRouter.patch('/:id', asyncHandler(defectImprovementController.update.bind(defectImprovementController)))

/** DELETE /api/v1/projects/:projectId/defect-improvements/:id — 刪除缺失改善 */
defectImprovementsRouter.delete('/:id', asyncHandler(defectImprovementController.delete.bind(defectImprovementController)))
