import { prisma } from '../../lib/db.js'

const userSelect = {
  id: true,
  email: true,
  name: true,
  systemRole: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
} as const

export type UserListItem = {
  id: string
  email: string
  name: string | null
  systemRole: string
  tenantId: string | null
  createdAt: Date
  updatedAt: Date
}

export const userRepository = {
  async findMany(args: { skip: number; take: number }) {
    return prisma.user.findMany({
      skip: args.skip,
      take: args.take,
      orderBy: { updatedAt: 'desc' },
      select: userSelect,
    }) as Promise<UserListItem[]>
  },

  async count() {
    return prisma.user.count()
  },

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: userSelect,
    }) as Promise<UserListItem | null>
  },

  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })
  },

  async create(data: {
    email: string
    passwordHash: string
    name: string | null
    systemRole: string
    tenantId: string | null
  }) {
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        systemRole: data.systemRole as 'platform_admin' | 'tenant_admin' | 'project_user',
        tenantId: data.tenantId,
      },
      select: userSelect,
    }) as Promise<UserListItem>
  },
}
