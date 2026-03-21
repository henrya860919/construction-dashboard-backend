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

/** DELETE .../pcces-imports/:importId — 軟刪除該版匯入與工項 */
pccesImportsRouter.delete(
  '/:importId',
  asyncHandler(pccesImportController.delete.bind(pccesImportController))
)

/** GET .../pcces-imports/:importId */
pccesImportsRouter.get(
  '/:importId',
  asyncHandler(pccesImportController.getById.bind(pccesImportController))
)
