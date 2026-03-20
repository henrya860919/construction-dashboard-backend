-- CreateTable
CREATE TABLE "tenant_module_disables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_module_disables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_module_disables_tenant_id_module_key" ON "tenant_module_disables"("tenant_id", "module");

-- CreateIndex
CREATE INDEX "tenant_module_disables_tenant_id_idx" ON "tenant_module_disables"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_module_disables" ADD CONSTRAINT "tenant_module_disables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
