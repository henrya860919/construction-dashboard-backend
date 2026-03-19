-- CreateTable
CREATE TABLE "drawing_nodes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drawing_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drawing_nodes_project_id_idx" ON "drawing_nodes"("project_id");

-- CreateIndex
CREATE INDEX "drawing_nodes_parent_id_idx" ON "drawing_nodes"("parent_id");

-- AddForeignKey
ALTER TABLE "drawing_nodes" ADD CONSTRAINT "drawing_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_nodes" ADD CONSTRAINT "drawing_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "drawing_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
