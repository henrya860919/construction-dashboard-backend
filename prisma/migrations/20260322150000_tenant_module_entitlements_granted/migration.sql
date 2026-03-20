-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "module_entitlements_granted" BOOLEAN NOT NULL DEFAULT false;

-- 既有租戶：遷移前「無 disable 列 = 全開」視同平台已開通，避免行為倒退
UPDATE "Tenant" SET "module_entitlements_granted" = true WHERE "deleted_at" IS NULL;
