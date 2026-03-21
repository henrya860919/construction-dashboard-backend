-- CreateTable
CREATE TABLE "tenant_permission_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_update" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_permission_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member_permissions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "can_create" BOOLEAN NOT NULL DEFAULT false,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_update" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_member_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_permission_templates_tenant_id_user_id_idx" ON "tenant_permission_templates"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_permission_templates_tenant_id_user_id_module_key" ON "tenant_permission_templates"("tenant_id", "user_id", "module");

-- CreateIndex
CREATE INDEX "project_member_permissions_project_id_user_id_idx" ON "project_member_permissions"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_member_permissions_project_id_user_id_module_key" ON "project_member_permissions"("project_id", "user_id", "module");

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "project_members_project_id_user_id_idx" ON "project_members"("project_id", "user_id");

-- （project_self_inspection_template_links 之索引見 migration 20260321120000_project_self_inspection_template_links）

-- AddForeignKey
ALTER TABLE "tenant_permission_templates" ADD CONSTRAINT "tenant_permission_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_permission_templates" ADD CONSTRAINT "tenant_permission_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_permissions" ADD CONSTRAINT "project_member_permissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_permissions" ADD CONSTRAINT "project_member_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
