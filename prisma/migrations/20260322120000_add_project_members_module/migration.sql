-- 新增功能模組 project.members：自 project.overview 複製旗標（既有租戶範本與專案成員權限）
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
  md5(random()::text || clock_timestamp()::text || t.tenant_id || t.user_id || 'project.members'),
  t.tenant_id,
  t.user_id,
  'project.members',
  t.can_create,
  t.can_read,
  t.can_update,
  t.can_delete,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenant_permission_templates" t
WHERE t.module = 'project.overview'
  AND NOT EXISTS (
    SELECT 1
    FROM "tenant_permission_templates" t2
    WHERE t2.tenant_id = t.tenant_id
      AND t2.user_id = t.user_id
      AND t2.module = 'project.members'
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
  md5(random()::text || clock_timestamp()::text || p.project_id || p.user_id || 'project.members'),
  p.project_id,
  p.user_id,
  'project.members',
  p.can_create,
  p.can_read,
  p.can_update,
  p.can_delete,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "project_member_permissions" p
WHERE p.module = 'project.overview'
  AND NOT EXISTS (
    SELECT 1
    FROM "project_member_permissions" p2
    WHERE p2.project_id = p.project_id
      AND p2.user_id = p.user_id
      AND p2.module = 'project.members'
  );
