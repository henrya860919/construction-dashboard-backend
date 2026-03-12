declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        name: string | null
        systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
        tenantId: string | null
      }
    }
  }
}

export {}
