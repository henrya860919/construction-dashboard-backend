# 專案內功能模組權限（RBAC）— 開發者指南

專案內存取由三層組成：

1. **專案准入**：`assertCanAccessProject`（`src/shared/project-access.ts`）— 是否為專案活躍成員／租戶管理員／平台管理員。
2. **租戶模組開通**：`Tenant.moduleEntitlementsGranted` — 平台尚未於後台儲存過模組設定時為 `false`，**有效**關閉集合＝全部模組（與 `tenant_module_disables` 列一併由 `getEffectiveDisabledModuleIdsSet` 計算）。`tenant_module_disables` — 列於此表之模組對該租戶**關閉**，**含 `tenant_admin`**；在已 `moduleEntitlementsGranted` 前提下未列視為開通。`assertProjectModuleAction` 在細粒度檢查前會先擋（`403` + `MODULE_NOT_ENTITLED`）。**`platform_admin` 不檢查開通**（維運／除錯）。**`tenant_admin`** 另受 `assertTenantMayOperateProjectsAndPermissions`：`moduleEntitlementsGranted` 為 false 或全部模組皆 disable 時，不可新增專案、不可改租戶範本／專案成員模組覆寫。
3. **模組動作**：`assertProjectModuleAction` — 通過開通檢查後，`platform_admin`／`tenant_admin` 略過 `project_member_permissions`；`project_user` 依四個 boolean。

`action`：`create` | `read` | `update` | `delete`，對應資料列上的 `canCreate`／`canRead`／`canUpdate`／`canDelete`。

---

## 新增一個「可進權限矩陣」的功能模組（Checklist）

請**依序**完成，避免漏接 API、矩陣或側欄。

| 步驟 | 位置 | 說明 |
|------|------|------|
| 1 | `src/constants/permission-modules.ts`（後端） | 在 `PERMISSION_MODULES` 陣列加入新 `moduleId`（點號命名，如 `construction.xxx`）。 |
| 2 | `src/constants/permission-modules.ts`（前端） | **同一順序、同一清單**；更新 `NAV_PATH_PERMISSION_MODULE`（專案內 path 後綴 → 模組）、`PERMISSION_MODULE_LABELS`（後台／矩陣顯示名）。 |
| 3 | Prisma migration | 為既有 `tenant_permission_templates`／`project_member_permissions` **補列**新模組（可複製鄰近模組旗標，見 `20260322120000_add_project_members_module`、`20260322170000_add_construction_pcces_module`）；勿只改常數不補 DB。 |
| 4 | `src/schemas/project-permission.ts` | `replacePermissionModulesSchema` 由 `PERMISSION_MODULES` 驅動，通常**不需手改**，確認編譯通過即可。 |
| 5 | `preset-roles.ts` | 若 preset 需特例，更新 `PRESET_TEMPLATES`／`defaultFlagsByProjectRole` 語意。 |
| 6 | 後端業務 Service | 每個對外方法開頭：`await assertProjectModuleAction(user, projectId, '<moduleId>', '<action>')`（內含准入與租戶開通；`platform_admin` 僅略過開通後之細粒度）。 |
| 7 | `docs/backend-prisma-api.md` | 簡述新模組守護的 API（若屬 3.7 範圍）。 |
| 8 | 前端路由 | `useProjectRoutePermissionGuard` 已依 `NAV_PATH_PERMISSION_MODULE` 擋無 `read` 者；新 path **必須**掛上對應鍵（含子路徑時確認 `resolvePermissionPathSuffix` 能對應到已登記鍵）。 |
| 9 | `navigation.ts` | 側欄／Layer2／Layer3 新連結的 `pathSuffix` 與步驟 2 一致。 |
| 10 | 頁面與按鈕 | 使用 `useProjectPermission(projectId)` 的 `can(moduleId, action)`，與後端動作一致；**勿**以 `tenant_admin` 前端短路為全開（應依 `my-permissions` store）。 |

**以下 UI 皆由 `PERMISSION_MODULES`＋`PERMISSION_MODULE_LABELS` 驅動，新增模組並補 migration 後即會出現；無需逐頁硬編清單，但必須完成步驟 1～3、8：**

- 平台方：**`PlatformTenantManageView`** 租戶「模組開通」勾選表
- 租戶後台：**`AdminTenantInfoView`** 唯讀模組開通狀態
- 租戶後台：**`AdminMembersView`** 成員權限範本矩陣（`PermissionMatrixForm`）
- 專案內：**`ProjectMembersView`** 成員模組覆寫矩陣

---

## 動作對照（建議約定）

| UI／業務 | 建議 `action` |
|----------|----------------|
| 列表、詳情、匯出唯讀 | `read` |
| 新增、上傳、建立、開「可選清單」供建立 | `create` |
| 修改欄位、狀態、批次變更（非刪除） | `update` |
| 刪除、移出、作廢 | `delete` |

**範例 — `project.members`：**

- 成員列表 → `read`
- 可加入名單、新增成員 → `create`
- 停用／啟用 → `update`
- 移出專案 → `delete`
- 專案內「成員模組權限覆寫」（`.../members/:userId/permissions`）→ **僅** `tenant_admin`／`platform_admin`，**不**使用 `assertProjectModuleAction`。

---

## 檔案 API：`category` → 模組

`file.service.ts` 的 `ensureProjectFile`（上傳／列表／讀取／刪除附件）依 `Attachment.category` 對應：

| `category` | 權限模組 |
|------------|----------|
| `drawing_revision` | `project.drawings` |
| `photo`（圖庫／影像管理，常數 `FILE_CATEGORY_PHOTO`） | `construction.photo` |
| `pcces_xml`（PCCES XML 歸檔，常數 `FILE_CATEGORY_PCCES_XML`） | `construction.pcces` |
| 其他或 `null` | `construction.upload` |

---

## 前端一句話模式

```ts
const projectId = computed(() => (route.params.projectId as string) ?? '')
const { can, canReadPath } = useProjectPermission(projectId)

// 依「頁」：與側欄相同 read 模組
canReadPath('/construction/defects')

// 依「模組 + 動作」（按鈕、區塊）
can('construction.defect', 'create')
```

`platform_admin` 在 `useProjectPermission` 內視為全 `true`；`tenant_admin` 與 `project_user` 皆依 store（對齊後端遮罩後之 `my-permissions`）。

---

## 相關檔案索引

| 用途 | 檔案 |
|------|------|
| 模組 id 清單 | 後端／前端 `src/constants/permission-modules.ts` |
| 後端檢查 | `project-permission.service.ts` → `assertProjectModuleAction` |
| 專案准入 | `shared/project-access.ts` → `assertCanAccessProject` |
| 租戶範本 API | `admin` 路由 + `project-permission` module |
| 專案覆寫 API | `projects/:projectId/members/:userId/permissions` |
| 規劃摘要 | `docs/permission-architecture-implementation-plan.md` |
