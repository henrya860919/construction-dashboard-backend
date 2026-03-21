-- AlterTable
ALTER TABLE "pcces_imports" ADD COLUMN "version_label" VARCHAR(200);

-- 既有第 1 版顯示為原契約（與前端語意一致）
UPDATE "pcces_imports" SET "version_label" = '原契約' WHERE "version" = 1 AND "version_label" IS NULL AND "deleted_at" IS NULL;
