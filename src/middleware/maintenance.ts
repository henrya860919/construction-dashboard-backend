import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/db.js'

const JWT_SECRET = process.env.JWT_SECRET as string | undefined

const MAINTENANCE_KEY = 'maintenance_mode'
const CACHE_MS = 5_000
let cached: { value: boolean; at: number } = { value: false, at: 0 }

/** 是否處於維護模式（供 middleware 與登入流程使用） */
export async function isMaintenanceMode(): Promise<boolean> {
  const now = Date.now()
  if (now - cached.at < CACHE_MS) return cached.value
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: MAINTENANCE_KEY } })
    cached = { value: row?.value === 'true', at: now }
    return cached.value
  } catch {
    return false
  }
}

/** 清除維護模式快取（PATCH /settings 後可呼叫，使開關即時生效） */
export function clearMaintenanceCache(): void {
  cached = { value: false, at: 0 }
}

/**
 * 維護模式：開啟時僅 platform_admin 可存取 API（登入除外）。
 * 應掛在 apiRouter 最前面，放行 / 與 /auth/login。
 */
export function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const path = req.path
  if (path === '/' || path === '/auth/login') {
    next()
    return
  }

  isMaintenanceMode()
    .then((on) => {
      if (!on) {
        next()
        return
      }
      const authHeader = req.headers.authorization
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
      if (!token || !JWT_SECRET) {
        res.status(503).json({
          error: {
            code: 'MAINTENANCE',
            message: '系統維護中，請稍後再試。',
          },
        })
        return
      }
      try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { systemRole?: string }
        if (decoded.systemRole === 'platform_admin') {
          next()
          return
        }
      } catch {
        // token 無效
      }
      res.status(503).json({
        error: {
          code: 'MAINTENANCE',
          message: '系統維護中，請稍後再試。',
        },
      })
    })
    .catch((e) => {
      console.error('maintenanceMiddleware', e)
      next()
    })
}
