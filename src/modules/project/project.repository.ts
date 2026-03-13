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
  designUnit: true,
  supervisionUnit: true,
  contractor: true,
  summary: true,
  benefits: true,
  startDate: true,
  plannedDurationDays: true,
  plannedEndDate: true,
  revisedEndDate: true,
  siteManager: true,
  contactPhone: true,
  projectStaff: true,
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
  designUnit: string | null
  supervisionUnit: string | null
  contractor: string | null
  summary: string | null
  benefits: string | null
  startDate: Date | null
  plannedDurationDays: number | null
  plannedEndDate: Date | null
  revisedEndDate: Date | null
  siteManager: string | null
  contactPhone: string | null
  projectStaff: string | null
}

export const projectRepository = {
  async findMany(args: { skip: number; take: number; tenantId?: string | null }) {
    const where = args.tenantId !== undefined ? { tenantId: args.tenantId } : undefined
    return prisma.project.findMany({
      where,
      skip: args.skip,
      take: args.take,
      orderBy: { updatedAt: 'desc' },
      select: projectSelect,
    }) as Promise<ProjectListItem[]>
  },

  async count(tenantId?: string | null) {
    const where = tenantId !== undefined ? { tenantId } : undefined
    return prisma.project.count({ where })
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

  async update(
    id: string,
    data: Partial<{
      name: string
      description: string | null
      code: string | null
      status: string
      designUnit: string | null
      supervisionUnit: string | null
      contractor: string | null
      summary: string | null
      benefits: string | null
      startDate: Date | null
      plannedDurationDays: number | null
      plannedEndDate: Date | null
      revisedEndDate: Date | null
      siteManager: string | null
      contactPhone: string | null
      projectStaff: string | null
    }>
  ) {
    return prisma.project.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.code !== undefined && { code: data.code }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.designUnit !== undefined && { designUnit: data.designUnit }),
        ...(data.supervisionUnit !== undefined && { supervisionUnit: data.supervisionUnit }),
        ...(data.contractor !== undefined && { contractor: data.contractor }),
        ...(data.summary !== undefined && { summary: data.summary }),
        ...(data.benefits !== undefined && { benefits: data.benefits }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.plannedDurationDays !== undefined && { plannedDurationDays: data.plannedDurationDays }),
        ...(data.plannedEndDate !== undefined && { plannedEndDate: data.plannedEndDate }),
        ...(data.revisedEndDate !== undefined && { revisedEndDate: data.revisedEndDate }),
        ...(data.siteManager !== undefined && { siteManager: data.siteManager }),
        ...(data.contactPhone !== undefined && { contactPhone: data.contactPhone }),
        ...(data.projectStaff !== undefined && { projectStaff: data.projectStaff }),
      },
      select: projectSelect,
    }) as Promise<ProjectListItem>
  },
}
