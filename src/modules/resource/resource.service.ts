import { AppError } from '../../shared/errors.js'
import { assertCanAccessProject } from '../../shared/project-access.js'
import { assertProjectModuleAction } from '../project-permission/project-permission.service.js'
import { resourceRepository, type ProjectResourceRecord } from './resource.repository.js'
import type {
  CreateProjectResourceBody,
  UpdateProjectResourceBody,
} from '../../schemas/resource.js'

type AuthUser = {
  id: string
  systemRole: 'platform_admin' | 'tenant_admin' | 'project_user'
  tenantId: string | null
}

async function ensureResource(
  projectId: string,
  user: AuthUser,
  action: 'read' | 'create' | 'update' | 'delete'
): Promise<void> {
  await assertCanAccessProject(user, projectId)
  await assertProjectModuleAction(user, projectId, 'project.resource', action)
}

const VALID_TYPES = ['labor', 'equipment', 'material'] as const

function assertValidType(type: string): asserts type is (typeof VALID_TYPES)[number] {
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    throw new AppError(400, 'BAD_REQUEST', '無效的資源類型')
  }
}

export const resourceService = {
  async list(
    projectId: string,
    type: string,
    user: AuthUser
  ): Promise<ProjectResourceRecord[]> {
    await ensureResource(projectId, user, 'read')
    assertValidType(type)
    return resourceRepository.findManyByProjectAndType(projectId, type)
  },

  async create(
    projectId: string,
    body: CreateProjectResourceBody,
    user: AuthUser
  ): Promise<ProjectResourceRecord> {
    await ensureResource(projectId, user, 'create')
    return resourceRepository.create({
      projectId,
      type: body.type,
      name: body.name.trim(),
      unit: body.unit.trim(),
      unitCost: body.unitCost,
      capacityType: body.capacityType?.trim() ?? null,
      dailyCapacity: body.dailyCapacity ?? null,
      vendor: body.vendor?.trim() ?? null,
      description: body.description?.trim() ?? null,
    })
  },

  async update(
    projectId: string,
    id: string,
    body: UpdateProjectResourceBody,
    user: AuthUser
  ): Promise<ProjectResourceRecord> {
    await ensureResource(projectId, user, 'update')
    const existing = await resourceRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該資源')
    }
    return resourceRepository.update(id, {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.unit !== undefined && { unit: body.unit.trim() }),
      ...(body.unitCost !== undefined && { unitCost: body.unitCost }),
      ...(body.capacityType !== undefined && {
        capacityType: body.capacityType?.trim() ?? null,
      }),
      ...(body.dailyCapacity !== undefined && {
        dailyCapacity: body.dailyCapacity ?? null,
      }),
      ...(body.vendor !== undefined && { vendor: body.vendor?.trim() ?? null }),
      ...(body.description !== undefined && {
        description: body.description?.trim() ?? null,
      }),
    })
  },

  async delete(projectId: string, id: string, user: AuthUser): Promise<void> {
    await ensureResource(projectId, user, 'delete')
    const existing = await resourceRepository.findById(id)
    if (!existing || existing.projectId !== projectId) {
      throw new AppError(404, 'NOT_FOUND', '找不到該資源')
    }
    await resourceRepository.delete(id, user.id)
  },
}
