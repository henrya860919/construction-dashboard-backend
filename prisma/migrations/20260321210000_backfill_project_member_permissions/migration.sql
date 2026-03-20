-- 為尚無任何 project_member_permissions 的 active 專案成員補齊列（與 preset-roles defaultFlagsByProjectRole 一致）
-- 須在 project_members.deleted_at 存在之後執行（見 20260321200000_add_soft_delete）
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
  md5(random()::text || clock_timestamp()::text || pm.project_id || pm.user_id || m.module),
  pm.project_id,
  pm.user_id,
  m.module,
  (pm.role = 'project_admin'::"ProjectRole"),
  true,
  (pm.role = 'project_admin'::"ProjectRole"),
  (pm.role = 'project_admin'::"ProjectRole"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "project_members" pm
CROSS JOIN (
  VALUES
    ('project.overview'),
    ('project.wbs'),
    ('project.gantt'),
    ('project.resource'),
    ('project.schedule'),
    ('project.risk'),
    ('project.duration'),
    ('project.drawings'),
    ('construction.monitor'),
    ('construction.upload'),
    ('construction.equipment'),
    ('construction.inspection'),
    ('construction.diary'),
    ('construction.defect'),
    ('construction.photo'),
    ('repair.overview'),
    ('repair.record')
) AS m(module)
WHERE pm.deleted_at IS NULL
  AND pm.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "project_member_permissions" p2
    WHERE p2.project_id = pm.project_id
      AND p2.user_id = pm.user_id
  );
