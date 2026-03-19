import { prisma } from '../../lib/db.js'

export type DrawingNodeRecord = {
  id: string
  projectId: string
  parentId: string | null
  kind: string
  name: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export const drawingNodeRepository = {
  async findManyByProjectId(projectId: string): Promise<DrawingNodeRecord[]> {
    return prisma.drawingNode.findMany({
      where: { projectId },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    })
  },

  async findById(id: string): Promise<DrawingNodeRecord | null> {
    return prisma.drawingNode.findUnique({ where: { id } })
  },

  async create(data: {
    projectId: string
    parentId: string | null
    kind: string
    name: string
    sortOrder: number
  }): Promise<DrawingNodeRecord> {
    return prisma.drawingNode.create({ data })
  },

  async update(id: string, data: { name?: string; parentId?: string | null; sortOrder?: number }) {
    return prisma.drawingNode.update({ where: { id }, data })
  },

  async deleteById(id: string): Promise<void> {
    await prisma.drawingNode.delete({ where: { id } })
  },
}
