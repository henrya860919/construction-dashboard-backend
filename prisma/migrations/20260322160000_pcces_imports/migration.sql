-- CreateTable
CREATE TABLE "pcces_imports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "document_type" TEXT,
    "file_name" TEXT NOT NULL,
    "attachment_id" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "general_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "pcces_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pcces_items" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "item_key" INTEGER NOT NULL,
    "parent_item_key" INTEGER,
    "item_no" TEXT NOT NULL,
    "item_kind" TEXT NOT NULL,
    "ref_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "amount_imported" DECIMAL(18,4),
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "pcces_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pcces_imports_project_id_idx" ON "pcces_imports"("project_id");

-- CreateIndex
CREATE INDEX "pcces_imports_created_at_idx" ON "pcces_imports"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pcces_imports_project_id_version_key" ON "pcces_imports"("project_id", "version");

-- CreateIndex
CREATE INDEX "pcces_items_import_id_idx" ON "pcces_items"("import_id");

-- CreateIndex
CREATE INDEX "pcces_items_import_id_item_kind_idx" ON "pcces_items"("import_id", "item_kind");

-- CreateIndex
CREATE UNIQUE INDEX "pcces_items_import_id_item_key_key" ON "pcces_items"("import_id", "item_key");

-- AddForeignKey
ALTER TABLE "pcces_imports" ADD CONSTRAINT "pcces_imports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pcces_imports" ADD CONSTRAINT "pcces_imports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pcces_imports" ADD CONSTRAINT "pcces_imports_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pcces_items" ADD CONSTRAINT "pcces_items_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "pcces_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
