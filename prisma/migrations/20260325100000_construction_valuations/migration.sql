-- CreateTable
CREATE TABLE "construction_valuations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT,
    "valuation_date" DATE,
    "header_remark" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "construction_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_valuation_lines" (
    "id" TEXT NOT NULL,
    "valuation_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "pcces_item_id" TEXT,
    "item_no" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "contract_qty" DECIMAL(18,4) NOT NULL,
    "approved_qty_after_change" DECIMAL(18,4),
    "unit_price" DECIMAL(18,4) NOT NULL,
    "current_period_qty" DECIMAL(18,4) NOT NULL,
    "remark" TEXT NOT NULL,

    CONSTRAINT "construction_valuation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "construction_valuations_project_id_idx" ON "construction_valuations"("project_id");

-- CreateIndex
CREATE INDEX "construction_valuations_project_id_valuation_date_idx" ON "construction_valuations"("project_id", "valuation_date" DESC);

-- CreateIndex
CREATE INDEX "construction_valuation_lines_valuation_id_idx" ON "construction_valuation_lines"("valuation_id");

-- CreateIndex
CREATE INDEX "construction_valuation_lines_pcces_item_id_idx" ON "construction_valuation_lines"("pcces_item_id");

-- AddForeignKey
ALTER TABLE "construction_valuations" ADD CONSTRAINT "construction_valuations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_valuations" ADD CONSTRAINT "construction_valuations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_valuation_lines" ADD CONSTRAINT "construction_valuation_lines_valuation_id_fkey" FOREIGN KEY ("valuation_id") REFERENCES "construction_valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_valuation_lines" ADD CONSTRAINT "construction_valuation_lines_pcces_item_id_fkey" FOREIGN KEY ("pcces_item_id") REFERENCES "pcces_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 新增功能模組 construction.valuation：自 construction.diary 複製旗標（租戶範本與專案成員權限）
INSERT INTO "tenant_permission_templates" (
  "id",
  "tenant_id",
  "user_id",
  "module",
  "can_create",
  "can_read",
  "can_update",
  "can_delete",
  "created_at",
  "updated_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || t.tenant_id || t.user_id || 'construction.valuation'),
  t.tenant_id,
  t.user_id,
  'construction.valuation',
  t.can_create,
  t.can_read,
  t.can_update,
  t.can_delete,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenant_permission_templates" t
WHERE t.module = 'construction.diary'
  AND NOT EXISTS (
    SELECT 1
    FROM "tenant_permission_templates" t2
    WHERE t2.tenant_id = t.tenant_id
      AND t2.user_id = t.user_id
      AND t2.module = 'construction.valuation'
  );

INSERT INTO "project_member_permissions" (
  "id",
  "project_id",
  "user_id",
  "module",
  "can_create",
  "can_read",
  "can_update",
  "can_delete",
  "created_at",
  "updated_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || p.project_id || p.user_id || 'construction.valuation'),
  p.project_id,
  p.user_id,
  'construction.valuation',
  p.can_create,
  p.can_read,
  p.can_update,
  p.can_delete,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "project_member_permissions" p
WHERE p.module = 'construction.diary'
  AND NOT EXISTS (
    SELECT 1
    FROM "project_member_permissions" p2
    WHERE p2.project_id = p.project_id
      AND p2.user_id = p.user_id
      AND p2.module = 'construction.valuation'
  );
