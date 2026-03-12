import { prisma } from '../../lib/db.js'

const projectSelect = {
  id: true,
  name: true,
  description: true,
  code: true,
  status: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
} as const

export type ProjectListItem = {
  id: string
  name: string
  description: string | null
  code: string | null
  status: string
  tenantId: string | null
  createdAt: Date
  updatedAt: Date
}

export const projectRepository = {
  async findMany(args: { skip: number; take: number }) {
    return prisma.project.findMany({
      skip: args.skip,
      take: args.take,
      orderBy: { updatedAt: 'desc' },
      select: projectSelect,
    }) as Promise<ProjectListItem[]>
  },

  async count() {
    return prisma.project.count()
  },

  async findById(id: string) {
    return prisma.project.findUnique({
      where: { id },
      select: projectSelect,
    }) as Promise<ProjectListItem | null>
  },

  async create(data: {
    name: string
    description: string | null
    code: string | null
    status: string
    tenantId: string | null
  }) {
    return prisma.project.create({
      data: {
        name: data.name,
        description: data.description,
        code: data.code,
        status: data.status,
        tenantId: data.tenantId,
      },
      select: projectSelect,
    }) as Promise<ProjectListItem>
  },
}
