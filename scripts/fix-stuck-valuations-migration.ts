/**
 * 一次性修復：construction_valuations migration 曾中途失敗，表已存在但無 FK、且
 * _prisma_migrations 卡住，導致後續 migration（含 version_label）無法 deploy。
 *
 * 執行：npx tsx scripts/fix-stuck-valuations-migration.ts
 * 需 DATABASE_URL（與 prisma 相同）
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const fks = [
  `ALTER TABLE "construction_valuations" ADD CONSTRAINT "construction_valuations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "construction_valuations" ADD CONSTRAINT "construction_valuations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "construction_valuation_lines" ADD CONSTRAINT "construction_valuation_lines_valuation_id_fkey" FOREIGN KEY ("valuation_id") REFERENCES "construction_valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "construction_valuation_lines" ADD CONSTRAINT "construction_valuation_lines_pcces_item_id_fkey" FOREIGN KEY ("pcces_item_id") REFERENCES "pcces_items"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
]

const permissionSql = `
INSERT INTO "tenant_permission_templates" (
  "id", "tenant_id", "user_id", "module",
  "can_create", "can_read", "can_update", "can_delete",
  "created_at", "updated_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || t.tenant_id || t.user_id || 'construction.valuation'),
  t.tenant_id, t.user_id, 'construction.valuation',
  t.can_create, t.can_read, t.can_update, t.can_delete,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenant_permission_templates" t
WHERE t.module = 'construction.diary'
  AND NOT EXISTS (
    SELECT 1 FROM "tenant_permission_templates" t2
    WHERE t2.tenant_id = t.tenant_id AND t2.user_id = t.user_id AND t2.module = 'construction.valuation'
  );

INSERT INTO "project_member_permissions" (
  "id", "project_id", "user_id", "module",
  "can_create", "can_read", "can_update", "can_delete",
  "created_at", "updated_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || p.project_id || p.user_id || 'construction.valuation'),
  p.project_id, p.user_id, 'construction.valuation',
  p.can_create, p.can_read, p.can_update, p.can_delete,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "project_member_permissions" p
WHERE p.module = 'construction.diary'
  AND NOT EXISTS (
    SELECT 1 FROM "project_member_permissions" p2
    WHERE p2.project_id = p.project_id AND p2.user_id = p.user_id AND p2.module = 'construction.valuation'
  );
`

async function main() {
  for (const sql of fks) {
    try {
      await prisma.$executeRawUnsafe(sql)
      console.log('OK:', sql.slice(0, 80) + '…')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('already exists')) {
        console.log('Skip (exists):', sql.slice(0, 60))
      } else {
        throw e
      }
    }
  }

  await prisma.$executeRawUnsafe(permissionSql)
  console.log('OK: permission backfill inserts')
  console.log('Next: npx prisma migrate resolve --applied 20260325100000_construction_valuations')
  console.log('Then:  npx prisma migrate deploy')

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
