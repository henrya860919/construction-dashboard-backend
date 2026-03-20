# 權限架構實作規劃（對照現有 Construction Dashboard）

本文將「權限範本 + 專案成員細粒度 CRUD」概念，對照**本專案實際技術棧與程式結構**，並列出**建議實作順序**。原始想法可參考外部《Permission Architecture Spec》；實作以本 repo（後端 Express + Prisma 7 + PostgreSQL）與 **construction-dashboard-frontend**（Vue 3 + Pinia）為準。

---

## 一、目標與非目標

### 目標

- **租戶層**：每位使用者有一組「權限範本」（每個功能模組 × `canCreate` / `canRead` / `canUpdate` / `canDelete`）。
- **專案層**：使用者被加入專案時，**自動複製**該範本到「專案成員權限」；之後僅在該專案可覆寫，**不反向修改範本**。
- **API**：在專案路由上依模組與動作拒絕未授權操作（403）；前端可依同一套資料隱藏按鈕／側欄項。
- **稽核**：延續既有稽核能力；必要時擴充欄位或 `details` 結構以支援「依專案篩選」與 before/after。

### 非目標（第一階段可不做）

- **不廢除 `platform_admin` 跨租戶能力**：第一階段**不會**移除平台管理員角色，也**不會**取消其跨租戶管理、切換租戶視角、或程式中對 `platform_admin` 略過專案成員檢查等既有行為；若日後要收斂權限邊界，應另開議題與遷移計畫。
- **不必一次為所有業務 API 補齊稽核**：`recordAudit()`、before/after 寫入 `details`、稽核查詢加 `projectId` 篩選等，可**依模組分批**補上，無須與權限資料表／`my-permissions` 等同一個 release 一次做完。
- 租戶管理員「還原已軟刪資料」的完整 UI（若產品要，可列為後續 epic）。

---

## 二、現況盤點（與規格的差異）

### 2.1 已存在

| 項目 | 現況 |
|------|------|
| 使用者／租戶 | `User`、`Tenant`；`User.systemRole`：`platform_admin` \| `tenant_admin` \| `project_user` |
| 專案成員 | `ProjectMember`：`projectId`、`userId`、**`ProjectRole`**（`project_admin` / `member` / `viewer`）、`status`（active / suspended）、軟刪欄位 |
| 專案存取檢查 | 多個 `*.service.ts` 內**各自**實作 `ensureUserCanAccessProject` 或類似邏輯；**不同模組規則不完全一致**（例如僅檢查租戶 vs 強制專案成員） |
| 稽核 | `AuditLog` 表 + `recordAudit()`（`action`、`resourceType`、`resourceId`、`tenantId`、`details` JSON 等） |
| 軟刪除 | 多數業務表已依 `docs/soft-delete.md` 使用 `deletedAt` / `deletedById` |
| 主鍵 | 一律 **cuid 字串**，非 spec 中的 `SERIAL` |

### 2.2 尚不存在

- `tenant_permission_templates`（租戶 × 使用者 × 模組）
- `project_member_permissions`（專案 × 使用者 × 模組）
- 統一的「模組 + 動作」授權層與 `GET .../my-permissions`
- 前端的 `usePermission` 與依專案快取的權限資料

### 2.3 與規格「兩種角色」的對應方式

| 規格用語 | 本專案對應 |
|----------|------------|
| 租戶管理員 | `systemRole === 'tenant_admin'`（建專案、管成員、設範本；專案內是否「全開」由產品決定，見 §4.2） |
| 一般成員 | `systemRole === 'project_user'` + `ProjectMember` active + `project_member_permissions` |
| （規格未列）平台管理員 | `platform_admin`：維持現有「跨租戶／略過成員檢查」行為並寫入內部規格，避免與租戶 RBAC 混淆 |

「專案負責人僅為資料欄位」：本專案可在 `Project` 既有欄位（如工地負責人、工程概要等）上統一命名與說明即可，**不必**新增權限角色。

---

## 三、功能模組識別碼（建議）

與規格一致採 **點號字串**，前後端共用常數（後端 `src/constants/` 或共用套件；前端 `src/constants/permissions.ts`）。

實際清單以 **`src/constants/permission-modules.ts`（前後端對齊）** 為準，包含例如：

`project.overview`, `project.members`, `project.wbs`, `project.gantt`, `project.resource`, `project.schedule`, `project.risk`, `project.duration`, `project.drawings`，以及 `construction.*`、`repair.*` 等。

**對照 UI**：`construction-dashboard-frontend` 的 `constants/permission-modules.ts` 內 **`NAV_PATH_PERMISSION_MODULE`**（path 後綴 → 模組），供側欄 `canReadPath` 與路由守衛使用。

---

## 四、資料庫設計（Prisma）

### 4.1 新增模型（名稱可微調，意涵建議如下）

1. **`TenantPermissionTemplate`**
   - `id`（cuid）
   - `tenantId` → `Tenant`
   - `userId` → `User`
   - `module`（建議 Prisma `enum PermissionModule` 或 `String` + 後端 Zod 白名單）
   - `canCreate`, `canRead`, `canUpdate`, `canDelete`（Boolean）
   - 建立／更新時間；若需軟刪，遵守 `docs/soft-delete.md` 與 **partial unique**（勿與舊 compound unique 衝突）

2. **`ProjectMemberPermission`**
   - `id`（cuid）
   - `projectId` → `Project`
   - `userId` → `User`
   - `module`（同上）
   - 四個 Boolean
   - 同上索引／唯一鍵與軟刪策略

**唯一性**：`(tenantId, userId, module)`、`(projectId, userId, module)`；若表含軟刪，應與其他表一致採 **DB partial unique**（見專案 soft-delete 文件）。

### 4.2 與既有 `ProjectRole` 的關係（決策建議）

| 策略 | 說明 |
|------|------|
| **建議（漸進）** | 保留 `ProjectRole`。新增權限列後，以 **細粒度表為準**；`project_admin` 可解讀為「該專案內預設等同全模組 CRUD」或由 migration **一次性展開**成多列。`viewer` 可對應「僅 R」的 preset。 |
| 長期 | Preset 按鈕（規格 §九）只寫入 `TenantPermissionTemplate`，不再依賴 `ProjectRole` 表達細部能力（可列 roadmap）。 |

### 4.3 稽核表

- **不要**新增與現有 `audit_logs` 重複的第二張表。
- 若需「依專案篩選」：評估在 `AuditLog` 新增可選 **`projectId`**（nullable），或於 `details` 固定鍵名 `projectId` 並在查詢 API 層處理（PostgreSQL JSON 可查，但報表與索引較麻煩，**建議能加欄位就加欄位**）。

---

## 五、後端實作要點

### 5.1 目錄與風格（對照規格 §十）

本專案慣例為 **module 化**（`controller` → `service` → `repository`），**不要**另起獨立 `services/` 與路由脫鉤。

| 規格示意 | 建議實際位置 |
|----------|----------------|
| `checkPermission.ts` | `src/middleware/require-project-permission.ts`（或類似）；內部呼叫 permission **service** |
| `projectMember.service` 複製範本 | 擴充 `src/modules/project-member/project-member.service.ts` 的 `add()` |
| 裸 SQL | **禁止**；一律 Prisma + 既有 `src/lib/db.ts` |

### 5.2 統一「專案層」准入（強烈建議先做）

新增 **`src/shared/project-access.ts`**（或 `src/modules/auth/project-access.service.ts`），集中：

1. **是否可進入該專案**（租戶一致、`ProjectMember` + `active`、`platform_admin` 略過規則、**`tenant_admin` 是否免成員**請產品定案後寫死一版全站一致）。
2. 供各業務 service **先呼叫**再查資料，逐步**刪除**各檔內重複的 `ensureUserCanAccessProject`。

> 現況部分模組僅比對 `tenantId`、部分強制成員，導入權限前應收斂，否則「有權限矩陣卻進不了專案」或「沒矩陣也能打 API」會並存。

### 5.3 功能層授權

- **Service 層**（推薦與現有 `AppError(403)` 一致）：在每個公開方法開頭呼叫 `assertProjectPermission(user, projectId, module, action)`。
- **Middleware**（可選）：僅適合「路由結構固定、projectId 必在 params」的群組；其餘仍靠 service 較穩。

**超級使用者規則（建議預設）**：

- `platform_admin`：略過專案成員與細粒度檢查（與現有多處邏輯對齊）。
- `tenant_admin`：略過細粒度檢查或僅略過「讀」— **需產品確認**；實作時與前端 `usePermission` 必須一致。

### 5.4 加入專案時複製範本

在 `projectMemberService.add()` 內，於 **Prisma transaction** 中：

1. `ProjectMember` create（現有邏輯）。
2. `findMany` 該使用者的 `TenantPermissionTemplate`。
3. `createMany` 到 `ProjectMemberPermission`（若範本為空，定義預設：全拒絕或依 `ProjectRole` 展開 preset）。

**注意**：覆寫只寫在 `ProjectMemberPermission`；更新範本 **不** 回溯已存在專案。

### 5.5 API 契約（新增／擴充）

| 用途 | 建議路徑（皆在 `/api/v1` 下） |
|------|-------------------------------|
| 目前使用者於某專案之有效權限 | `GET /projects/:projectId/my-permissions` → `{ data: { modules: Record<string, { canCreate, canRead, canUpdate, canDelete }> } }` |
| 租戶後台：編輯使用者範本 | `GET/PATCH /admin/users/:userId/permission-template`（或掛在現有 admin 成員 API 下） |
| 專案：編輯某成員覆寫 | `GET/PATCH /projects/:projectId/members/:userId/permissions`；`POST .../reset` 重設為範本 |
| Preset 套用 | `POST /admin/users/:userId/permission-template/apply-preset` body: `{ presetKey }` |

需符合既有 **Zod schema**、`asyncHandler`、`{ data }`／`{ error }` 錯誤格式（見 `.cursor/rules/api-contract.mdc`）。

### 5.6 稽核（取代規格中的動態 SQL middleware）

- **不要**使用 `SELECT * FROM ${table}` 類 middleware。
- 延用 `recordAudit()`；在 **controller 或 service 成功路徑** 呼叫，將 `before`/`after` 放入 `details`（或新增 `projectId` 欄位後一併寫入）。
- 平台端既有 `platform-admin-monitoring` 稽核列表可逐步增加篩選維度（若新增 `projectId`）。

---

## 六、前端實作要點（construction-dashboard-frontend）

### 6.1 狀態

- **`src/stores/auth.ts`**：可擴充 `permissionsByProjectId`，或新建 `permission.ts` store。
- 進入 `/p/:projectId/...` 時 **lazy** 呼叫 `GET .../my-permissions` 並快取；切換專案或登出時清除。

### 6.2 Composable

- 新增 `src/composables/usePermission.ts`：`can(module, action)`，`projectId` 為 **string**（與路由 param 一致）。
- `tenant_admin` / `platform_admin` 是否一律 `true` 須與後端 §5.3 一致。

### 6.3 UI

- **側欄**：`AppSidebar.vue` + `constants/navigation.ts` 依 `can(..., 'read')` 過濾專案內項目。
- **後台**：在現有 `AdminMembersView.vue` 等流程上擴充「權限矩陣」與 preset；專案內新增「成員權限」頁（路由、`breadcrumb`、`routes.ts` 依專案規範註冊）。
- **操作紀錄**：平台已有監控類頁面者可擴充篩選；租戶後台若要独立頁，另開 view 並串新 query API。

---

## 七、實作階段與順序（建議）

### Phase 0：決策（短會即可）

- [ ] `tenant_admin` 進入專案：是否一定要 `ProjectMember`？與現有 WBS／缺失改善差異如何統一？
- [ ] `tenant_admin` / `platform_admin` 是否略過細粒度 permission 檢查？
- [ ] 範本為空時，新成員預設「全拒」還是依 `ProjectRole` 產生預設列？

### Phase 1：資料層

- [ ] Prisma schema 新增兩張權限表 +（可選）`AuditLog.projectId`
- [ ] `npm run db:migrate:dev -- --name ...` 與 `db:generate`
- [ ] Seed：為既有測試使用者寫入範本／或 migration 補齊現有 `ProjectMember` 的 `ProjectMemberPermission`

### Phase 2：後端核心

- [ ] `project-access` 單一入口 + 替換／收斂各 service 重複邏輯（可分批模組）
- [ ] `permission` module：repository + `assertProjectPermission` + `getMyPermissions`
- [ ] `project-member.service` `add` transaction 複製範本
- [ ] 管理 API：範本 CRUD、專案覆寫、reset、preset

### Phase 3：業務 API 掛載權限

- [ ] 依優先模組（例如 `construction.defect`、`repair.record`）在 service 層加上權限檢查
- [ ] 文件：`docs/backend-prisma-api.md` 補上權限相關說明與 `my-permissions`

### Phase 4：前端

- [x] API client + types（`src/api/project-permissions.ts` 等）
- [x] store + composable（`projectPermissions` store、`useProjectPermission`、路由守衛）
- [x] 側欄與關鍵入口過濾（`AppSidebar` 等）
- [x] 後台租戶權限範本矩陣（`AdminMembersView`）+ **專案內成員覆寫**（契約 → 專案成員：`ProjectMembersView` 更多選單「專案權限」）

### Phase 5：稽核強化（可與 Phase 3 交錯）

- [ ] 高風險寫入路徑補 `recordAudit` + `details` 結構約定
- [ ] 若有 `projectId` 欄位，補索引與查詢 API

---

## 八、驗收檢查清單（摘要）

- [ ] 同一使用者在專案 A 覆寫權限後，專案 B 仍與範本一致（新加入時複製當下範本）。
- [ ] 無 `read` 時無法透過 API 列出資料（非僅前端隱藏）。
- [ ] `tenant_admin` 編輯範本不影響已存在專案之 `ProjectMemberPermission`。
- [ ] 軟刪、partial unique、403 錯誤格式符合專案規範。
- [ ] `npm run build`（後端與前端）通過。

---

## 九、參考文件

- `docs/soft-delete.md`、`.cursor/rules/soft-delete.mdc`
- `docs/backend-prisma-api.md`
- `prisma/schema.prisma`（`User`、`ProjectMember`、`AuditLog`）
- 前端：`.cursor/rules/project-routes.mdc`、`constants/navigation.ts`

---

*文件版本：依本專案現況整理；實作時請以當下 schema 與路由為準並更新本文件「現況盤點」小節。*
