import { Router } from 'express'
import { asyncHandler } from '../shared/utils/async-handler.js'
import { drawingNodeController } from '../modules/drawing-node/index.js'

export const drawingNodesRouter = Router({ mergeParams: true })

drawingNodesRouter.get('/', asyncHandler(drawingNodeController.list.bind(drawingNodeController)))
drawingNodesRouter.post('/', asyncHandler(drawingNodeController.create.bind(drawingNodeController)))
drawingNodesRouter.get(
  '/:id/revisions',
  asyncHandler(drawingNodeController.listRevisions.bind(drawingNodeController))
)
drawingNodesRouter.patch('/:id/move', asyncHandler(drawingNodeController.move.bind(drawingNodeController)))
drawingNodesRouter.patch('/:id', asyncHandler(drawingNodeController.update.bind(drawingNodeController)))
drawingNodesRouter.delete('/:id', asyncHandler(drawingNodeController.delete.bind(drawingNodeController)))
