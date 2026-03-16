import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../shared/errors.js'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    })
    return
  }

  const statusCode = 500
  const code = 'INTERNAL_ERROR'
  // 正式環境只回傳通用訊息；開發環境回傳實際錯誤訊息方便除錯
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err instanceof Error
        ? err.message
        : 'Internal server error'

  // 開發／除錯時在伺服器 log 印出實際錯誤，方便排查（勿將 stack 回傳給前端）
  console.error('[500]', err)

  res.status(statusCode).json({
    error: { code, message },
  })
}
