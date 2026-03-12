import type { Request } from 'express'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function parsePageLimit(req: Request): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Number(req.query.page) || DEFAULT_PAGE)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT))
  const skip = (page - 1) * limit
  return { page, limit, skip }
}
