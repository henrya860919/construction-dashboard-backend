import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { prisma } from '../lib/db.js'
import { loginSchema } from '../schemas/auth.js'
import { authMiddleware } from '../middleware/auth.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required')
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'TOO_MANY_REQUESTS', message: '登入嘗試次數過多，請稍後再試' },
    })
  },
})

export const authRouter = Router()

/** POST /api/v1/auth/login — 登入，回傳 accessToken 與 user */
authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '欄位驗證失敗',
          details: parsed.error.flatten(),
        },
      })
      return
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    })

    if (!user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Email 或密碼錯誤' },
      })
      return
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!valid) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Email 或密碼錯誤' },
      })
      return
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
        tenantId: user.tenantId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    )

    res.status(200).json({
      data: {
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          systemRole: user.systemRole,
          tenantId: user.tenantId,
        },
      },
    })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    console.error('POST /auth/login', err.message, err.stack)
    const payload: { error: { code: string; message: string; details?: string } } = {
      error: { code: 'INTERNAL_ERROR', message: '登入失敗' },
    }
    if (process.env.NODE_ENV !== 'production') {
      payload.error.details = err.message
    }
    res.status(500).json(payload)
  }
})

/** GET /api/v1/auth/me — 回傳當前登入者（需 Authorization） */
authRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: '未登入' },
    })
    return
  }
  res.status(200).json({ data: req.user })
})
