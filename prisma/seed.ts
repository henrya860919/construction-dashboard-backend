/**
 * 資料庫 seed：建立預設租戶、人員、專案與專案成員（開發／展示用）
 * 執行：npm run db:seed 或 prisma migrate reset 時會自動執行
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcrypt'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required for seed')
}

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding...')

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: '預設租戶',
      slug: 'default',
    },
  })
  console.log('Tenant:', tenant.name)

  const passwordHash = await bcrypt.hash('password123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash,
      name: '系統管理員',
      systemRole: 'tenant_admin',
      tenantId: tenant.id,
    },
  })
  console.log('User (admin):', admin.email)

  const member = await prisma.user.upsert({
    where: { email: 'member@example.com' },
    update: {},
    create: {
      email: 'member@example.com',
      passwordHash,
      name: '專案成員',
      systemRole: 'project_user',
      tenantId: tenant.id,
    },
  })
  console.log('User (member):', member.email)

  const platformAdmin = await prisma.user.upsert({
    where: { email: 'platform@example.com' },
    update: {},
    create: {
      email: 'platform@example.com',
      passwordHash,
      name: '平台管理員',
      systemRole: 'platform_admin',
      tenantId: null,
    },
  })
  console.log('User (platform):', platformAdmin.email)

  const proj1 = await prisma.project.upsert({
    where: { id: 'seed-proj-1' },
    update: {},
    create: {
      id: 'seed-proj-1',
      name: '示範工程 A',
      description: '北區道路改善工程',
      code: 'DEMO-A',
      status: 'active',
      tenantId: tenant.id,
    },
  })
  console.log('Project:', proj1.name)

  const proj2 = await prisma.project.upsert({
    where: { id: 'seed-proj-2' },
    update: {},
    create: {
      id: 'seed-proj-2',
      name: '示範工程 B',
      description: '南區排水系統工程',
      code: 'DEMO-B',
      status: 'active',
      tenantId: tenant.id,
    },
  })
  console.log('Project:', proj2.name)

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: { projectId: proj1.id, userId: admin.id },
    },
    update: {},
    create: {
      projectId: proj1.id,
      userId: admin.id,
      role: 'project_admin',
    },
  })
  await prisma.projectMember.upsert({
    where: {
      projectId_userId: { projectId: proj1.id, userId: member.id },
    },
    update: {},
    create: {
      projectId: proj1.id,
      userId: member.id,
      role: 'member',
    },
  })
  await prisma.projectMember.upsert({
    where: {
      projectId_userId: { projectId: proj2.id, userId: admin.id },
    },
    update: {},
    create: {
      projectId: proj2.id,
      userId: admin.id,
      role: 'project_admin',
    },
  })
  console.log('Project members created')

  console.log('Seed done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
