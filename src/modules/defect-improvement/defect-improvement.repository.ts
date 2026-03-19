import { prisma } from '../../lib/db.js'

const defectSelect = {
  id: true,
  projectId: true,
  description: true,
  discoveredBy: true,
  priority: true,
  floor: true,
  location: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

export type DefectListItem = {
  id: string
  projectId: string
  description: string
  discoveredBy: string
  priority: string
  floor: string | null
  location: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}

export const defectImprovementRepository = {
  async findManyByProject(
    projectId: string,
    args: { status?: string; skip?: number; take?: number }
  ) {
    const where = { projectId, ...(args.status ? { status: args.status } : {}) }
    return prisma.defectImprovement.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: args.skip ?? 0,
      take: args.take ?? 100,
      select: defectSelect,
    }) as Promise<DefectListItem[]>
  },

  async countByProject(projectId: string, status?: string) {
    const where = { projectId, ...(status ? { status } : {}) }
    return prisma.defectImprovement.count({ where })
  },

  async findById(id: string) {
    return prisma.defectImprovement.findUnique({
      where: { id },
      select: defectSelect,
    }) as Promise<DefectListItem | null>
  },

  async findByIdWithProject(id: string) {
    return prisma.defectImprovement.findUnique({
      where: { id },
      select: { ...defectSelect, projectId: true },
    })
  },

  async create(data: {
    projectId: string
    description: string
    discoveredBy: string
    priority: string
    floor: string | null
    location: string | null
    status: string
  }) {
    return prisma.defectImprovement.create({
      data: {
        projectId: data.projectId,
        description: data.description,
        discoveredBy: data.discoveredBy,
        priority: data.priority,
        floor: data.floor,
        location: data.location,
        status: data.status,
      },
      select: defectSelect,
    }) as Promise<DefectListItem>
  },

  async update(
    id: string,
    data: Partial<{
      description: string
      discoveredBy: string
      priority: string
      floor: string | null
      location: string | null
      status: string
    }>
  ) {
    return prisma.defectImprovement.update({
      where: { id },
      data: {
        ...(data.description !== undefined && { description: data.description }),
        ...(data.discoveredBy !== undefined && { discoveredBy: data.discoveredBy }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.floor !== undefined && { floor: data.floor }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.status !== undefined && { status: data.status }),
      },
      select: defectSelect,
    }) as Promise<DefectListItem>
  },

  async delete(id: string) {
    await prisma.defectImprovement.delete({ where: { id } })
  },
}

const recordSelect = {
  id: true,
  defectId: true,
  content: true,
  recordedById: true,
  createdAt: true,
  recordedBy: { select: { id: true, name: true, email: true } },
} as const

export type DefectExecutionRecordRow = {
  id: string
  defectId: string
  content: string
  recordedById: string | null
  createdAt: Date
  recordedBy: { id: string; name: string | null; email: string } | null
}

export const defectExecutionRecordRepository = {
  async findById(recordId: string) {
    return prisma.defectExecutionRecord.findUnique({
      where: { id: recordId },
      select: recordSelect,
    }) as Promise<DefectExecutionRecordRow | null>
  },

  async findManyByDefectId(defectId: string) {
    return prisma.defectExecutionRecord.findMany({
      where: { defectId },
      orderBy: { createdAt: 'desc' },
      select: recordSelect,
    }) as Promise<DefectExecutionRecordRow[]>
  },

  async create(data: {
    defectId: string
    content: string
    recordedById: string | null
  }) {
    return prisma.defectExecutionRecord.create({
      data: {
        defectId: data.defectId,
        content: data.content,
        recordedById: data.recordedById,
      },
      select: recordSelect,
    }) as Promise<DefectExecutionRecordRow>
  },
}
