import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required')
}

/** 從 Authorization: Bearer <token> 解析並驗證 JWT，寫入 req.user */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '未提供或無效的 token' },
    })
    return
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET as jwt.Secret)
    const payload = decoded as unknown as {
      sub: string
      email: string
      name?: string
      systemRole: string
      tenantId?: string | null
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name ?? null,
      systemRole: payload.systemRole as 'platform_admin' | 'tenant_admin' | 'project_user',
      tenantId: payload.tenantId ?? null,
    }
    next()
  } catch {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'token 無效或已過期' },
    })
  }
}

/** 僅 platform_admin 可通過；須在 authMiddleware 之後使用 */
export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '請先登入' },
    })
    return
  }
  if (req.user.systemRole !== 'platform_admin') {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: '僅平台管理員可存取' },
    })
    return
  }
  next()
}

/** 租戶管理員或平台管理員可通過（可進單租後台）；須在 authMiddleware 之後使用 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '請先登入' },
    })
    return
  }
  const allowed = req.user.systemRole === 'platform_admin' || req.user.systemRole === 'tenant_admin'
  if (!allowed) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: '僅管理員可存取後台' },
    })
    return
  }
  next()
}
