import type { Request, Response, NextFunction } from 'express'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500
  const code = (err as { code?: string }).code ?? 'INTERNAL_ERROR'
  const message =
    statusCode === 500
      ? 'Internal server error'
      : (err as Error).message ?? 'Unknown error'

  res.status(statusCode).json({
    error: { code, message },
  })
}
