import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { constructionDailyLogController } from '../modules/construction-daily-log/index.js'

export const constructionDailyLogsRouter = Router({ mergeParams: true })

constructionDailyLogsRouter.get(
  '/defaults',
  asyncHandler(constructionDailyLogController.defaults.bind(constructionDailyLogController))
)

constructionDailyLogsRouter.get(
  '/',
  asyncHandler(constructionDailyLogController.list.bind(constructionDailyLogController))
)

constructionDailyLogsRouter.post(
  '/',
  asyncHandler(constructionDailyLogController.create.bind(constructionDailyLogController))
)

constructionDailyLogsRouter.get(
  '/:logId',
  asyncHandler(constructionDailyLogController.getById.bind(constructionDailyLogController))
)

constructionDailyLogsRouter.patch(
  '/:logId',
  asyncHandler(constructionDailyLogController.update.bind(constructionDailyLogController))
)

constructionDailyLogsRouter.delete(
  '/:logId',
  asyncHandler(constructionDailyLogController.delete.bind(constructionDailyLogController))
)
