-- 新增功能模組 construction.pcces：自 construction.diary 複製旗標（租戶範本與專案成員權限）
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
  md5(random()::text || clock_timestamp()::text || t.tenant_id || t.user_id || 'construction.pcces'),
  t.tenant_id,
  t.user_id,
  'construction.pcces',
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
      AND t2.module = 'construction.pcces'
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
  md5(random()::text || clock_timestamp()::text || p.project_id || p.user_id || 'construction.pcces'),
  p.project_id,
  p.user_id,
  'construction.pcces',
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
      AND p2.module = 'construction.pcces'
  );
