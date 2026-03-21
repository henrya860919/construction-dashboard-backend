-- CreateTable
CREATE TABLE "pcces_item_changes" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "pcces_item_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "excel_item_no" VARCHAR(512),
    "excel_description" TEXT,
    "excel_unit" VARCHAR(512),
    "excel_qty" VARCHAR(128),
    "excel_unit_price" VARCHAR(128),
    "excel_remark" TEXT,
    "prev_quantity" VARCHAR(128),
    "prev_unit_price" VARCHAR(128),
    "new_quantity" VARCHAR(128),
    "new_unit_price" VARCHAR(128),
    "parent_item_key" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "pcces_item_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pcces_item_changes_import_id_idx" ON "pcces_item_changes"("import_id");

-- CreateIndex
CREATE INDEX "pcces_item_changes_pcces_item_id_idx" ON "pcces_item_changes"("pcces_item_id");

-- AddForeignKey
ALTER TABLE "pcces_item_changes" ADD CONSTRAINT "pcces_item_changes_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "pcces_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pcces_item_changes" ADD CONSTRAINT "pcces_item_changes_pcces_item_id_fkey" FOREIGN KEY ("pcces_item_id") REFERENCES "pcces_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pcces_item_changes" ADD CONSTRAINT "pcces_item_changes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
