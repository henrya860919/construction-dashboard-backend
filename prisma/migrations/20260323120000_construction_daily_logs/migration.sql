-- CreateTable
CREATE TABLE "construction_daily_logs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "report_no" TEXT,
    "weather_am" TEXT,
    "weather_pm" TEXT,
    "log_date" DATE NOT NULL,
    "project_name" TEXT NOT NULL,
    "contractor_name" TEXT NOT NULL,
    "approved_duration_days" INTEGER,
    "accumulated_days" INTEGER,
    "remaining_days" INTEGER,
    "extended_days" INTEGER,
    "start_date" DATE,
    "completion_date" DATE,
    "actual_progress" DECIMAL(6,2),
    "special_item_a" TEXT NOT NULL DEFAULT '',
    "special_item_b" TEXT NOT NULL DEFAULT '',
    "has_technician" BOOLEAN NOT NULL DEFAULT false,
    "pre_work_education" TEXT NOT NULL DEFAULT 'no',
    "new_worker_insurance" TEXT NOT NULL DEFAULT 'no_new',
    "ppe_check" TEXT NOT NULL DEFAULT 'no',
    "other_safety_notes" TEXT NOT NULL DEFAULT '',
    "sample_test_record" TEXT NOT NULL DEFAULT '',
    "subcontractor_notice" TEXT NOT NULL DEFAULT '',
    "important_notes" TEXT NOT NULL DEFAULT '',
    "site_manager_signed" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "construction_daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_daily_log_work_items" (
    "id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "work_item_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "contract_qty" DECIMAL(18,4) NOT NULL,
    "daily_qty" DECIMAL(18,4) NOT NULL,
    "accumulated_qty" DECIMAL(18,4) NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "construction_daily_log_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_daily_log_materials" (
    "id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "material_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "contract_qty" DECIMAL(18,4) NOT NULL,
    "daily_used_qty" DECIMAL(18,4) NOT NULL,
    "accumulated_qty" DECIMAL(18,4) NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "construction_daily_log_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_daily_log_personnel_equipment" (
    "id" TEXT NOT NULL,
    "log_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "work_type" TEXT NOT NULL DEFAULT '',
    "daily_workers" INTEGER NOT NULL DEFAULT 0,
    "accumulated_workers" INTEGER NOT NULL DEFAULT 0,
    "equipment_name" TEXT NOT NULL DEFAULT '',
    "daily_equipment_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accumulated_equipment_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "construction_daily_log_personnel_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "construction_daily_logs_project_id_idx" ON "construction_daily_logs"("project_id");

-- CreateIndex
CREATE INDEX "construction_daily_logs_project_id_log_date_idx" ON "construction_daily_logs"("project_id", "log_date" DESC);

-- CreateIndex
CREATE INDEX "construction_daily_log_work_items_log_id_idx" ON "construction_daily_log_work_items"("log_id");

-- CreateIndex
CREATE INDEX "construction_daily_log_materials_log_id_idx" ON "construction_daily_log_materials"("log_id");

-- CreateIndex
CREATE INDEX "construction_daily_log_personnel_equipment_log_id_idx" ON "construction_daily_log_personnel_equipment"("log_id");

-- AddForeignKey
ALTER TABLE "construction_daily_logs" ADD CONSTRAINT "construction_daily_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_daily_logs" ADD CONSTRAINT "construction_daily_logs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_daily_log_work_items" ADD CONSTRAINT "construction_daily_log_work_items_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "construction_daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_daily_log_materials" ADD CONSTRAINT "construction_daily_log_materials_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "construction_daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_daily_log_personnel_equipment" ADD CONSTRAINT "construction_daily_log_personnel_equipment_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "construction_daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
