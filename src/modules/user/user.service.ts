import bcrypt from 'bcrypt'
import { AppError } from '../../shared/errors.js'
import { userRepository, type UserListItem } from './user.repository.js'
import type { CreateUserBody } from '../../schemas/user.js'

export const userService = {
  async list(args: { page: number; limit: number; skip: number }): Promise<{
    list: UserListItem[]
    total: number
  }> {
    const [list, total] = await Promise.all([
      userRepository.findMany({ skip: args.skip, take: args.limit }),
      userRepository.count(),
    ])
    return { list, total }
  },

  async getById(id: string): Promise<UserListItem> {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', '找不到該使用者')
    }
    return user
  },

  async create(data: CreateUserBody): Promise<UserListItem> {
    const existing = await userRepository.findByEmail(data.email)
    if (existing) {
      throw new AppError(409, 'CONFLICT', '此 Email 已註冊')
    }
    const passwordHash = await bcrypt.hash(data.password, 10)
    return userRepository.create({
      email: data.email,
      passwordHash,
      name: data.name ?? null,
      systemRole: data.systemRole ?? 'project_user',
      tenantId: data.tenantId ?? null,
    })
  },
}
