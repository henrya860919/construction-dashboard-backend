import { AppError } from '../../shared/errors.js'
import { projectRepository, type ProjectListItem } from './project.repository.js'
import type { CreateProjectBody } from '../../schemas/project.js'

export const projectService = {
  async list(args: { page: number; limit: number; skip: number }): Promise<{
    list: ProjectListItem[]
    total: number
  }> {
    const [list, total] = await Promise.all([
      projectRepository.findMany({ skip: args.skip, take: args.limit }),
      projectRepository.count(),
    ])
    return { list, total }
  },

  async getById(id: string): Promise<ProjectListItem> {
    const project = await projectRepository.findById(id)
    if (!project) {
      throw new AppError(404, 'NOT_FOUND', '找不到該專案')
    }
    return project
  },

  async create(data: CreateProjectBody): Promise<ProjectListItem> {
    return projectRepository.create({
      name: data.name,
      description: data.description ?? null,
      code: data.code ?? null,
      status: data.status ?? 'active',
      tenantId: data.tenantId ?? null,
    })
  },
}
