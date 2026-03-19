-- CreateTable
CREATE TABLE "defect_improvements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discovered_by" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "floor" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defect_improvements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_execution_records" (
    "id" TEXT NOT NULL,
    "defect_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defect_execution_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "defect_improvements_project_id_idx" ON "defect_improvements"("project_id");

-- CreateIndex
CREATE INDEX "defect_improvements_project_id_status_idx" ON "defect_improvements"("project_id", "status");

-- CreateIndex
CREATE INDEX "defect_execution_records_defect_id_idx" ON "defect_execution_records"("defect_id");

-- AddForeignKey
ALTER TABLE "defect_improvements" ADD CONSTRAINT "defect_improvements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_execution_records" ADD CONSTRAINT "defect_execution_records_defect_id_fkey" FOREIGN KEY ("defect_id") REFERENCES "defect_improvements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_execution_records" ADD CONSTRAINT "defect_execution_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
