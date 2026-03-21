import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { uploadSingleFile } from '../middleware/upload.js'
import { pccesImportController } from '../modules/pcces-import/index.js'

export const pccesImportsRouter = Router({ mergeParams: true })

/** GET /api/v1/projects/:projectId/pcces-imports */
pccesImportsRouter.get('/', asyncHandler(pccesImportController.list.bind(pccesImportController)))

/** POST /api/v1/projects/:projectId/pcces-imports — multipart field: file */
pccesImportsRouter.post(
  '/',
  uploadSingleFile,
  asyncHandler(pccesImportController.upload.bind(pccesImportController))
)

/** GET .../pcces-imports/:importId/items — 須在 /:importId 前註冊 */
pccesImportsRouter.get(
  '/:importId/items',
  asyncHandler(pccesImportController.listItems.bind(pccesImportController))
)

/** POST .../pcces-imports/:importId/excel-apply — 以該版為基底套用 Excel 變更，產生新版本 */
pccesImportsRouter.post(
  '/:importId/excel-apply',
  asyncHandler(pccesImportController.applyExcelChanges.bind(pccesImportController))
)

/** POST .../pcces-imports/:importId/approve — 核定該版（施工日誌始得引用） */
pccesImportsRouter.post(
  '/:importId/approve',
  asyncHandler(pccesImportController.approve.bind(pccesImportController))
)

/** DELETE .../pcces-imports/:importId — 軟刪除該版匯入與工項 */
pccesImportsRouter.delete(
  '/:importId',
  asyncHandler(pccesImportController.delete.bind(pccesImportController))
)

/** PATCH .../pcces-imports/:importId — 更新版本顯示名稱（body: { versionLabel }，空字串表示清除自訂名稱） */
pccesImportsRouter.patch(
  '/:importId',
  asyncHandler(pccesImportController.patch.bind(pccesImportController))
)

/** GET .../pcces-imports/:importId */
pccesImportsRouter.get(
  '/:importId',
  asyncHandler(pccesImportController.getById.bind(pccesImportController))
)
