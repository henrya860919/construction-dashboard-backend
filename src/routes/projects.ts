import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { projectController } from '../modules/project/index.js'
import { fileController } from '../modules/file/index.js'
import { formTemplateController } from '../modules/form-template/index.js'
import { uploadSingleFile } from '../middleware/upload.js'
import { scheduleAdjustmentsRouter } from './schedule-adjustments.js'
import { wbsRouter } from './wbs.js'
import { issueRisksRouter } from './issue-risks.js'
import { resourcesRouter } from './resources.js'
import { albumsRouter } from './albums.js'
import { photoFavoriteController } from '../modules/photo-favorite/index.js'
import { cameraController } from '../modules/camera/index.js'
import { projectMemberController } from '../modules/project-member/index.js'
import { defectImprovementsRouter } from './defect-improvements.js'
import { repairRequestsRouter } from './repair-requests.js'
import { projectSelfInspectionsRouter } from './project-self-inspections.js'
import { drawingNodesRouter } from './drawing-nodes.js'

export const projectsRouter = Router()

/** GET /api/v1/projects — 專案列表（分頁；之後依登入者權限過濾） */
projectsRouter.get('/', asyncHandler(projectController.list.bind(projectController)))

/** POST /api/v1/projects — 新增專案（之後需驗證權限） */
projectsRouter.post('/', asyncHandler(projectController.create.bind(projectController)))

/** 工期調整（須在 /:id 之前掛載，否則會被 :id 吃掉） */
projectsRouter.use('/:projectId/schedule-adjustments', scheduleAdjustmentsRouter)

/** 缺失改善（手機／現場：列表、詳情、執行紀錄） */
projectsRouter.use('/:projectId/defect-improvements', defectImprovementsRouter)

/** 報修（手機／現場：列表、詳情、照片與附件） */
projectsRouter.use('/:projectId/repair-requests', repairRequestsRouter)

/** 自主查驗（專案內：樣板列表、填寫紀錄） */
projectsRouter.use('/:projectId/self-inspections', projectSelfInspectionsRouter)

/** 圖說管理（樹狀分類／圖說項、檔案版本） */
projectsRouter.use('/:projectId/drawing-nodes', drawingNodesRouter)

/** WBS 工作分解結構（列表、新增、編輯、刪除、拖移） */
projectsRouter.use('/:projectId/wbs', wbsRouter)

/** 議題風險表（列表、新增、編輯、刪除） */
projectsRouter.use('/:projectId/issue-risks', issueRisksRouter)

/** 資源庫（人力、機具、材料） */
projectsRouter.use('/:projectId/resources', resourcesRouter)

/** GET /api/v1/projects/:projectId/files — 專案附件列表（須在 /:id 之前） */
projectsRouter.get('/:projectId/files', asyncHandler(fileController.listByProject.bind(fileController)))

/** 專案成員（從租戶成員引入；列表、可加入名單、新增、移除；available 須在 list 前註冊） */
projectsRouter.get('/:projectId/members/available', asyncHandler(projectMemberController.listAvailable.bind(projectMemberController)))
projectsRouter.get('/:projectId/members', asyncHandler(projectMemberController.list.bind(projectMemberController)))
projectsRouter.post('/:projectId/members', asyncHandler(projectMemberController.add.bind(projectMemberController)))
projectsRouter.patch('/:projectId/members/:userId', asyncHandler(projectMemberController.setStatus.bind(projectMemberController)))
projectsRouter.delete('/:projectId/members/:userId', asyncHandler(projectMemberController.remove.bind(projectMemberController)))

/** GET /api/v1/projects/:projectId/form-templates — 專案可見表單樣板（預設+專案） */
projectsRouter.get('/:projectId/form-templates', asyncHandler(formTemplateController.listForProject.bind(formTemplateController)))

/** POST /api/v1/projects/:projectId/form-templates — 專案新增表單樣板（multipart: file, name, description） */
projectsRouter.post('/:projectId/form-templates', uploadSingleFile, asyncHandler(formTemplateController.createForProject.bind(formTemplateController)))

/** 相簿（照片管理） */
projectsRouter.use('/:projectId/albums', albumsRouter)

/** 我的最愛（個人，他人不可見） */
projectsRouter.get('/:projectId/photo-favorites', asyncHandler(photoFavoriteController.list.bind(photoFavoriteController)))
projectsRouter.post('/:projectId/photo-favorites', asyncHandler(photoFavoriteController.add.bind(photoFavoriteController)))
projectsRouter.delete('/:projectId/photo-favorites/:attachmentId', asyncHandler(photoFavoriteController.remove.bind(photoFavoriteController)))

/** 攝影機（CCTV / go2rtc 推流） */
projectsRouter.get('/:projectId/cameras', asyncHandler(cameraController.list.bind(cameraController)))
/** 專案層級一鍵安裝包（須在 :cameraId 前註冊，避免被當成 cameraId） */
projectsRouter.get(
  '/:projectId/cameras/install-package',
  asyncHandler(cameraController.downloadProjectInstallPackage.bind(cameraController))
)
projectsRouter.post('/:projectId/cameras', asyncHandler(cameraController.create.bind(cameraController)))
projectsRouter.get('/:projectId/cameras/:cameraId/install', asyncHandler(cameraController.getByIdForInstall.bind(cameraController)))
projectsRouter.get('/:projectId/cameras/:cameraId/play-url', asyncHandler(cameraController.getPlayUrl.bind(cameraController)))
projectsRouter.get('/:projectId/cameras/:cameraId/install-config/download', asyncHandler(cameraController.downloadInstallYaml.bind(cameraController)))
projectsRouter.get('/:projectId/cameras/:cameraId/install-package', asyncHandler(cameraController.downloadInstallPackage.bind(cameraController)))
projectsRouter.get('/:projectId/cameras/:cameraId/install-config', asyncHandler(cameraController.getInstallConfig.bind(cameraController)))
projectsRouter.get('/:projectId/cameras/:cameraId', asyncHandler(cameraController.getById.bind(cameraController)))
projectsRouter.patch(
  '/:projectId/cameras/:cameraId/connection-status-override',
  asyncHandler(cameraController.setConnectionStatusOverride.bind(cameraController))
)
projectsRouter.patch('/:projectId/cameras/:cameraId', asyncHandler(cameraController.update.bind(cameraController)))
projectsRouter.delete('/:projectId/cameras/:cameraId', asyncHandler(cameraController.delete.bind(cameraController)))

/** GET /api/v1/projects/:id — 單一專案（含專案資訊欄位） */
projectsRouter.get('/:id', asyncHandler(projectController.getById.bind(projectController)))

/** PATCH /api/v1/projects/:id — 更新專案（含專案資訊；限同租戶或 platform_admin） */
projectsRouter.patch('/:id', asyncHandler(projectController.update.bind(projectController)))
