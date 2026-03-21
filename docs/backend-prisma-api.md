# 後端：Prisma 與人員／專案 API

本專案使用 **Prisma 7** 作為 ORM（非「插件」，而是取代直接使用 `pg` 的資料庫層），搭配 PostgreSQL。人員（User）與專案（Project）為首批實作的資源。

---

## 一、Prisma 使用方式

### 1.1 為何用 Prisma

- **型別安全**：從 `schema.prisma` 產生 TypeScript 型別，減少手寫 SQL 與型別不同步。
- **Schema 即文件**：`prisma/schema.prisma` 定義資料表與關聯，遷移由 Prisma 管理。
- **Prisma 7**：連線透過 **driver adapter**（`@prisma/adapter-pg`），`DATABASE_URL` 在 `prisma.config.ts` 設定。

### 1.2 常用指令

| 指令 | 說明 |
|------|------|
| `npm run db:generate` | 依 schema 產生 Prisma Client（`node_modules/@prisma/client`） |
| `npm run db:migrate` | 套用所有未執行的 migration（正式／CI 用） |
| `npm run db:migrate:dev` | 開發時新增或套用 migration（會連線 DB） |
| `npm run db:seed` | 執行 seed，寫入預設租戶／人員／專案／專案成員（開發用） |
| `npm run db:reset` | **重設 DB**：刪除所有資料、重新套用 migration、再執行 seed |
| `npm run db:studio` | 開啟 Prisma Studio 管理資料 |

### 1.3 在程式裡使用

- 連線單例：`src/lib/db.ts` 匯出 `prisma`（使用 `PrismaPg` adapter + `DATABASE_URL`）。
- 啟動前請確保 `.env` 有 `DATABASE_URL`（本地見 `docs/docker-database.md`）。
- 範例：`import { prisma } from '../lib/db.js'`，然後 `prisma.project.findMany()`、`prisma.user.create(...)` 等。

### 1.4 首次建立資料表

1. 啟動 PostgreSQL（例如 `docker compose up -d`）。
2. `.env` 設定 `DATABASE_URL=postgresql://postgres:postgres@localhost:5435/construction_dashboard`。
3. 執行：`npm run db:migrate`（套用 `prisma/migrations` 內既有 migration）。

若日後要新增欄位或表，改 `prisma/schema.prisma` 後執行 `npm run db:migrate:dev -- --name 描述` 產生新 migration。

### 1.5 Seed 與 Reset

- **Seed**（`npm run db:seed`）：執行 `prisma/seed.ts`，建立預設資料（一筆租戶、兩位使用者、兩筆專案、專案成員關聯）。使用者密碼皆為 `password123`（僅供開發）。
- **Reset**（`npm run db:reset`）：會**刪除資料庫內所有資料**、重新套用所有 migration、再自動執行 seed。開發時想清空重來時使用；**勿在正式環境執行**。

### 1.6 軟刪除（DELETE API）

多數業務實體以 `deleted_at`／`deleted_by_id` 做**邏輯刪除**，HTTP `DELETE` 對應 `update` 而非 `prisma.delete`。查詢預設排除已刪列；`User` 軟刪後不可登入。完整約定見 **`docs/soft-delete.md`** 與 **`.cursor/rules/soft-delete.mdc`**。

---

## 二、資料模型（人員與專案）

- **Tenant**：租戶（多租戶用；單租戶可僅一筆或固定 id）。
- **User**：人員，含 `email`、`passwordHash`、`name`、`systemRole`（platform_admin / tenant_admin / project_user）、`tenantId`。
- **Project**：專案，含 `name`、`description`、`code`、`status`、`tenantId`。
- **ProjectMember**：專案成員，關聯 User 與 Project，欄位 `role`（project_admin / member / viewer）。

詳見 `prisma/schema.prisma`。

---

## 三、API 端點（v1）

Base URL：`/api/v1`。成功回應格式：`{ data, meta? }`；錯誤：`{ error: { code, message } }`（見 `.cursor/rules/api-contract.mdc`）。

### 3.1 專案（Projects）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects` | 專案列表，query：`page`、`limit`，回傳 `data` + `meta: { page, limit, total }` |
| GET | `/api/v1/projects/:id` | 單一專案 |
| POST | `/api/v1/projects` | 新增專案，body：`name`（必填）、`description`、`code`、`status`、`tenantId`（選填） |

### 3.2 人員（Users）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/users` | 人員列表，query：`page`、`limit` |
| GET | `/api/v1/users/:id` | 單一人員（不含密碼） |
| POST | `/api/v1/users` | 新增人員，body：`email`（必填）、`password`（必填，至少 6 碼）、`name`、`systemRole`、`tenantId`（選填） |

專案列表與人員列表已依登入者與租戶過濾；專案內 API 另依 **模組權限**（見 3.7）檢查。

### 3.3 報修（Repair requests，手機／現場）

掛在專案下，須登入且為專案成員（與缺失改善相同權限模式）。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/repair-requests` | 列表，query：`status`（`in_progress` \| `completed`）、`page`、`limit` |
| POST | `/api/v1/projects/:projectId/repair-requests` | 新增，body 含 `customerName`、`contactPhone`、`repairContent`、`problemCategory` 等；`photoAttachmentIds`、`fileAttachmentIds` 為已上傳附件 id（category 分別為 `repair_photo`、`repair_attachment`） |
| GET | `/api/v1/projects/:projectId/repair-requests/:id` | 單筆（含 `photos`、`attachments`） |
| PATCH | `/api/v1/projects/:projectId/repair-requests/:id` | 更新欄位 |
| DELETE | `/api/v1/projects/:projectId/repair-requests/:id` | 刪除 |
| GET | `/api/v1/projects/:projectId/repair-requests/:id/records` | 該筆報修之報修紀錄列表（含照片） |
| POST | `/api/v1/projects/:projectId/repair-requests/:id/records` | 新增報修紀錄；`attachmentIds` → `category=repair_record` |
| GET | `/api/v1/projects/:projectId/repair-requests/:id/records/:recordId` | 單一報修紀錄（含照片） |

### 3.4 自主檢查樣板（租戶後台 Admin）

掛在 **`/api/v1/admin`**，須 `tenant_admin` 或 `platform_admin`。資料為租戶層：`SelfInspectionTemplate`（含 `headerConfig` JSON：表單抬頭欄位／`timingOptions`（現場 radio）／`resultLegendOptions`（檢查結果圖例與列選項，現場 radio））+ `SelfInspectionTemplateBlock` + `SelfInspectionTemplateBlockItem`（區塊內查驗列：分類、項目、標準）（`prisma/schema.prisma`）。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/admin/self-inspection-templates` | 列表；query：`tenantId`（platform_admin 指定租戶）、`status`（`active` \| `archived`）；項目含 `blockCount`（不含 `headerConfig`） |
| POST | `/api/v1/admin/self-inspection-templates` | 新增樣板；body：`name`、`description?`、`status?`、`headerConfig?`（完整結構見 Zod `headerConfigSchema`）；platform_admin 可於 body 帶 `tenantId` |
| GET | `/api/v1/admin/self-inspection-templates/:id` | 單筆：`template`（含合併預設後之 `headerConfig`）與 `blocks[]`（每區塊含 `items[]`）；query：`tenantId?` |
| PATCH | `/api/v1/admin/self-inspection-templates/:id` | 更新樣板；body 可含 `headerConfig`；query：`tenantId?` |
| DELETE | `/api/v1/admin/self-inspection-templates/:id` | 刪除樣板（cascade 區塊與查驗列）；query：`tenantId?` |
| POST | `/api/v1/admin/self-inspection-templates/:id/blocks` | 新增區塊；body：`title`、`description?` |
| PATCH | `/api/v1/admin/self-inspection-templates/:id/blocks/:blockId` | 更新區塊（含 `sortOrder`） |
| DELETE | `/api/v1/admin/self-inspection-templates/:id/blocks/:blockId` | 刪除區塊（cascade 該區塊之 `items`） |
| POST | `/api/v1/admin/self-inspection-templates/:id/blocks/:blockId/items` | 新增查驗列；body：`categoryLabel`、`itemName`、`standardText` |
| PATCH | `/api/v1/admin/self-inspection-templates/:id/blocks/:blockId/items/:itemId` | 更新查驗列（可含 `sortOrder`） |
| DELETE | `/api/v1/admin/self-inspection-templates/:id/blocks/:blockId/items/:itemId` | 刪除查驗列 |

### 3.5 自主查驗紀錄（專案內，桌機／之後手機）

掛在 **`/api/v1/projects/:projectId/self-inspections`**，須登入且為專案成員（與缺失改善相同；`platform_admin` 免成員檢查）。樣板須與專案 **`tenantId` 相同**。

**專案須先「匯入」樣板**（`ProjectSelfInspectionTemplateLink`）：僅已匯入者會出現在專案列表；租戶後台 **active** 且 **尚未匯入** 者可從 **`GET .../templates/available`** 挑選後 **`POST .../templates`** 匯入。同一樣板不可重複匯入（**409**）。**移除匯入**（`DELETE .../templates/:templateId`）僅當該樣板於本專案 **查驗紀錄筆數為 0**，否則 **400**。已匯入之封存樣板仍可讀取既有紀錄，但 **不可新增** 查驗紀錄。

`SelfInspectionRecord`：`filledPayload` JSON（`header` 含 `inspectionName`／`projectName`（工程名稱）等抬頭欄位、`items[itemId]` → `actualText`／`resultOptionId`）；後端會以**當下租戶樣板**驗證 `itemId` 與選項 id。建立成功後會寫入 **`structureSnapshot`**（與 `GET .../templates/:templateId` 相同語意之 `template` + `blocks[]`，`recordCount` 固定為 0），之後租戶修改樣板不影響該筆紀錄詳情顯示；**舊資料**無快照者詳情仍讀即時樣板（相容）。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/self-inspections/templates/import-catalog` | 租戶 **active** 樣板列表；每項 **`imported`**（是否已匯入本專案，供 UI disabled） |
| GET | `/api/v1/projects/:projectId/self-inspections/templates/available` | 可匯入樣板：租戶 **active**、且 **未** 匯入本專案 |
| POST | `/api/v1/projects/:projectId/self-inspections/templates` | 匯入樣板；body：`{ templateId }`（Zod `importProjectSelfInspectionTemplateSchema`） |
| GET | `/api/v1/projects/:projectId/self-inspections/templates` | **已匯入**本專案之樣板；每項含 **`recordCount`**、**`linkedAt`** |
| DELETE | `/api/v1/projects/:projectId/self-inspections/templates/:templateId` | 移除匯入；僅當本專案對該樣板 **查驗紀錄為 0** |
| GET | `/api/v1/projects/:projectId/self-inspections/templates/:templateId` | 樣板結構（`template` + `blocks[]`）與 **`recordCount`**（須已匯入）；**即時租戶樣板**，供新增查驗與零紀錄時同步最新 |
| GET | `/api/v1/projects/:projectId/self-inspections/templates/:templateId/records` | 紀錄列表；query：`page`、`limit`；**不含** `structureSnapshot`（減量） |
| POST | `/api/v1/projects/:projectId/self-inspections/templates/:templateId/records` | 新增一筆；body：`{ filledPayload }`（見 Zod `filledPayloadSchema`）；以**當下樣板**驗證；回應含 **`structureSnapshot`** |
| GET | `/api/v1/projects/:projectId/self-inspections/templates/:templateId/records/:recordId` | 單筆（含 `filledBy`、**`structureSnapshot`**；有快照則詳情不必再拉 hub） |

### 3.6 圖說管理（專案內樹狀）

須登入且為**專案活躍成員**（與缺失改善相同；`platform_admin` 免成員檢查）。租戶須與專案一致。

- **節點**：`DrawingNode`，`kind` 為 `folder`（僅分類，不可掛檔）或 `leaf`（圖說項目）。
- **版本鏈**：`POST /api/v1/files/upload` 上傳時帶 `category=drawing_revision`、`businessId=<leaf 節點 id>`；同一 leaf 多筆附件即為版本歷程；**最新版**為該 `businessId` 下 `createdAt` 最大者。
- **下載最新**：前端對最新附件 id 呼叫 `GET /api/v1/files/:id?download=true`。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/drawing-nodes` | 樹狀列表；每個 `leaf` 含 `latestFile`（最新一筆之 `id`、`fileName`、`fileSize`、`mimeType`、`createdAt`）或 `null` |
| POST | `/api/v1/projects/:projectId/drawing-nodes` | 新增節點；body：`name`、`kind`（`folder`\|`leaf`）、`parentId?`（頂層省略或 `null`）；父節點須為 `folder` |
| PATCH | `/api/v1/projects/:projectId/drawing-nodes/:id` | 更新名稱；body：`{ name }` |
| DELETE | `/api/v1/projects/:projectId/drawing-nodes/:id` | 刪除節點（子樹 cascade）；一併刪除其下所有 leaf 之 `drawing_revision` 附件實體 |
| PATCH | `/api/v1/projects/:projectId/drawing-nodes/:id/move` | 拖曳排序／變更父層；body：`parentId?`（頂層為 `null`）、`insertBeforeId?`；回傳整棵樹（同 GET） |
| GET | `/api/v1/projects/:projectId/drawing-nodes/:id/revisions` | 僅 `leaf`：該圖說項之版本列表（新→舊），含 `uploadedBy` |

### 3.7 專案層模組權限（RBAC）

- **資料表**：`tenant_permission_templates`（租戶 × 使用者 × 模組）、`project_member_permissions`（專案 × 使用者 × 模組）；模組 id 見 `src/constants/permission-modules.ts`。
- **存取專案**：`assertCanAccessProject`（`src/shared/project-access.ts`）— `platform_admin` 任意專案；`tenant_admin` 同租戶專案；`project_user` 須為 active `ProjectMember`。
- **租戶模組開通**：`Tenant.moduleEntitlementsGranted` 為 `false`（新建租戶預設）時，租戶端視為**尚未開通**：有效遮罩為**全部模組關閉**，且 `tenant_admin` **不可** `POST /projects`、不可編輯租戶權限範本／專案內成員模組覆寫（`403` + `TENANT_MODULES_NOT_GRANTED`）。平台於 `PUT /api/v1/platform-admin/tenants/:id/module-entitlements` 成功後會將該欄位設為 `true`。另：`tenant_module_disables` 列出身分表示該模組關閉；若已開通但**全部**模組皆在 disable 表內，同上擋新增專案與權限編輯（`TENANT_MODULES_ALL_DISABLED`）。`my-permissions` 與 `assertProjectModuleAction` 對非 `platform_admin` 依**有效**關閉集合遮罩／拒絕（`MODULE_NOT_ENTITLED`）。平台後台：`GET`／`PUT .../module-entitlements`（body：`{ disabledModuleIds?: string[] }`，整包取代 disable 列；`disabledModuleIds` 缺漏或非陣列時視為 `[]`）。回傳含 `moduleEntitlementsGranted` 與 `disabledModuleIds`。租戶後台唯讀：`GET /api/v1/admin/tenant/module-entitlements`（同形；`tenant_admin` 依 JWT；`platform_admin` 須 `?tenantId=`）。
- **細粒度**：通過開通檢查後，`platform_admin`／`tenant_admin` 略過 `project_member_permissions`；`project_user` 依四個 boolean（create／read／update／delete）檢查。
- **新成員**：`POST .../members` 成功後會依租戶範本複製權限；範本為空時依 `ProjectRole` 預設（`project_admin` 全開、其餘僅 read）。既有成員可透過 migration `20260321210000_backfill_project_member_permissions` 或 `npm run db:seed` 內之 backfill 補列。
- **`project.members`（專案成員）**：列表與檢視為 **read**；可加入名單與 `POST .../members` 為 **create**；成員狀態（停用／啟用）為 **update**；`DELETE .../members` 為 **delete**。**`GET/PUT/POST .../members/:userId/permissions`（專案內模組權限覆寫／重設）僅 `tenant_admin`／`platform_admin`**，不依 `project.members` 細粒度。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/my-permissions` | 目前使用者於該專案之模組權限；`{ data: { modules: Record<module, { canCreate, canRead, canUpdate, canDelete }> } }` |
| GET | `/api/v1/projects/:projectId/members/:userId/permissions` | 租戶／平台管理員：`{ data: { modules, baselineModules } }`；`baselineModules` 與「重設為租戶範本」後一致，供前端比對專案客製 |
| PUT | `/api/v1/projects/:projectId/members/:userId/permissions` | 同上；覆寫；body 須含**全部**模組鍵（見 Zod `replacePermissionModulesSchema`）；回應同含 `modules` + `baselineModules` |
| POST | `/api/v1/projects/:projectId/members/:userId/permissions/reset` | 同上；重設為租戶範本；回應同含 `modules` + `baselineModules` |
| GET | `/api/v1/admin/users/:userId/permission-template` | 租戶後台：使用者權限範本；`platform_admin` 可帶 query `tenantId` |
| PUT | `/api/v1/admin/users/:userId/permission-template` | 更新範本（body 同上，全模組鍵） |
| POST | `/api/v1/admin/users/:userId/permission-template/apply-preset` | 一鍵套用 preset；body：`{ presetKey }`（見後端 `PRESET_TEMPLATES`） |

帶 `projectId` 的警報 API（`GET /api/v1/alerts/current`、`/history`）需 **`construction.monitor` read**。

詳見 **`docs/permission-architecture-implementation-plan.md`**、**`docs/project-module-permissions.md`**（新增模組 checklist）。

### 3.8 PCCES／eTender XML 匯入（施工日誌工項來源）

- **資料表**：`PccesImport`（專案內版本遞增）、`PccesItem`（單次匯入之 PayItem 列，含 `remark`／`percent`；軟刪欄位保留供未來）。解析使用 **`fast-xml-parser`**，工項依 **`itemKey` 升冪** 儲存。
- **權限**：**`construction.pcces`**（與 **`construction.diary`** 分離；租戶開通／成員矩陣獨立勾選）— 列表／明細為 **read**，上傳 XML／**Excel 變更確認匯入**為 **create**，**核定**為 **update**，刪除匯入版本為 **delete**（軟刪除該版 `PccesImport`、`PccesItem`、`PccesItemChange`，並嘗試軟刪歸檔 XML）。
- **核定**：`PccesImport.approved_at`／`approved_by_id`；**施工日誌工項僅能引用「已核定」版本中、version 最大者**之 `general` 列（見 `findLatestApprovedImport`）。同一版可重複呼叫核定（已核定則 idempotent）。
- **檔案歸檔**：成功寫入工項後另以 `fileService.uploadFile` 上傳，`category=pcces_xml`、`businessId=<importId>`；對應模組 **`construction.pcces`**；失敗不影響已解析之 DB 資料。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/pcces-imports` | 該專案匯入版本列表（新到舊）；每筆含 **`versionLabel`**（可為空：第 1 版顯示語意「原契約」、第 2 版起顯示「第 N 版」由前端決定） |
| POST | `/api/v1/projects/:projectId/pcces-imports` | `multipart/form-data`，欄位 **`file`**（`.xml`）；可選 **`versionLabel`**（第 1 版若缺省則後端存為「原契約」；**第 2 版起必填**非空白）；解析 ETenderSheet／DetailList／PayItem；建立新版並寫入 `PccesItem` |
| PATCH | `/api/v1/projects/:projectId/pcces-imports/:importId` | JSON `{ "versionLabel": string }`（≤200 字，可空字串以清空自訂名稱）；**update** 權限；回傳該次匯入摘要 |
| GET | `/api/v1/projects/:projectId/pcces-imports/:importId` | 單次匯入摘要 |
| GET | `/api/v1/projects/:projectId/pcces-imports/:importId/items` | 工項列表；query：`all=1` 一次回傳全部（單筆匯入上限 10 萬筆）；否則 `page`、`limit`（預設分頁，上限見共用 `parsePageLimit`）；`itemKind`：`general` \| `mainItem`，省略則全部；回傳 `{ data: { import, items }, meta: { page, limit, total } }` |
| POST | `/api/v1/projects/:projectId/pcces-imports/:importId/excel-apply` | **Excel 變更匯入**：JSON body（見 `pccesExcelApplyBodySchema`，含必填 **`versionLabel`**）；`:importId` 為**基底版**；交易內複製該版全部工項至**新版本**（`document_type=excel_change`）、套用 auto／manual 變更、重算階層複價、寫入 `pcces_item_changes`；**有變更之工項**其 `PccesItem.remark` 會在尾端加上 **`（第 N 次變更）`**（`N`＝專案內該 `itemKey` 曾於 Excel 變更版被異動的累計次數，含本次；寫入前會先剝除備註尾端既有同格式後綴）；手動增列視為第 1 次；回 **201** 與新匯入摘要 |
| POST | `/api/v1/projects/:projectId/pcces-imports/:importId/approve` | **核定**該版；寫入 `approved_at`／`approved_by_id`；回傳該次匯入摘要（含 `approvedAt` ISO） |
| DELETE | `/api/v1/projects/:projectId/pcces-imports/:importId` | 軟刪除該次匯入與其工項；成功回 `{ data: { ok: true } }` |

### 3.9 公共工程施工日誌（依附表四）

- **資料表**：`ConstructionDailyLog`（主檔，軟刪除）、`ConstructionDailyLogWorkItem`（可選 **`pcces_item_id`** → `PccesItem`，供累計依 `pccesItemId`／`itemKey` 聚合；可選 **`unit_price`** 為綁定 PCCES 時之**單價快照**）、`ConstructionDailyLogMaterial`、`ConstructionDailyLogPersonnelEquipment`（子表隨主檔以 `log_id` 關聯，`onDelete: Cascade`；更新時以交易 **刪除子表後重建**）。
- **工項與 PCCES**：`workItems[].pccesItemId` 可選；若有，伺服器會驗證屬目前**最新已核定**版之末層工項。填表日期之前之 **prior** 為同專案、**同 `itemKey` 於所有已核定 PCCES 版**之工項列，在其他日誌之 `dailyQty` 加總（跨版延續，不因換版換 `PccesItem.id` 而歸零）；寫入 **`accumulatedQty = prior + dailyQty`**。契約上限與顯示用之 **`work_item_name`／`unit`／`contract_qty`** 以請求正文（或 GET 後再 PATCH 所帶）之**快照**為準，**不以**換版後最新 `PccesItem` 覆寫；檢核 **`prior + dailyQty ≤ contract_qty`（正文）**（`WORK_ITEM_QTY_EXCEEDED`）。可選 **`workItems[].unitPrice`** 寫入 **`unit_price` 快照**；省略則存 `null`。手填列省略 `pccesItemId`，累計由客戶提供但仍受契約上限檢查。估驗之「前期已估驗」與「日誌累計至某日」對綁定 PCCES 之列亦**依 `itemKey` 跨版**彙總。
- **權限**：**`construction.diary`** — 列表／詳情／預設值為 **read**，建立 **create**，更新 **update**，刪除 **delete**（主檔軟刪除）。
- **同專案同填表日期**：不可重複（服務層 `findFirst` 檢查）；回傳 **409 CONFLICT**。
- **預定進度（%）**：不存 DB；GET 時依 **開工日**、**核定工期（天）**、**填表日期** 線性推算（與前端預覽公式一致），資料不足時為 `null`。實際進度為人工填寫欄位。

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/construction-daily-logs/defaults` | 新增表單預設：自 `Project` 帶出工程名稱、承攬廠商、開工日、工期（天） |
| GET | `/api/v1/projects/:projectId/construction-daily-logs/pcces-work-items` | 施工項目選擇器；query：**`logDate=YYYY-MM-DD`**（必填）、`excludeLogId`（編輯時排除自身）；回 `{ data: { pccesImport, rows, groups, items } }`：**`pccesImport`** 為 **填表日（UTC 日曆天）當日或以前已核定之最高 version**（契約欄位所依版本）。**`rows`** 之 **樹狀、`pccesItemId` 仍屬「目前最新核定版」**（與儲存／normalize 一致）；**項次、工程項目、單位、契約數量、單價** 則依 **`itemKey`** 自上述「填表日有效版」覆寫（例：3/22 換版後，填表日 3/21 仍見舊版契約數與單價；3/22 起見新版）。**`priorAccumulatedQty`** 仍為同 `itemKey` 跨版累計至填表日前一日。排序 **`itemKey` 升序**；`isStructuralLeaf` 依**最新版**樹；`items`＝末層子集；**`groups` 為空陣列** |
| GET | `/api/v1/projects/:projectId/construction-daily-logs` | 分頁列表；query：`page`、`limit`；`{ data, meta: { page, limit, total } }` |
| POST | `/api/v1/projects/:projectId/construction-daily-logs` | 建立；body 見 Zod `constructionDailyLogCreateSchema`（含 `workItems`、`materials`、`personnelEquipmentRows` 陣列） |
| GET | `/api/v1/projects/:projectId/construction-daily-logs/:logId` | 單筆含子表；含唯讀 `plannedProgress`；`workItems[]` 含 **`pccesStructuralLeaf`**（`null`＝手填列；綁定 PCCES 時表是否為結構末層，供前端隱藏目錄列之單價等） |
| PATCH | `/api/v1/projects/:projectId/construction-daily-logs/:logId` | 整張覆寫（含子表） |
| DELETE | `/api/v1/projects/:projectId/construction-daily-logs/:logId` | 軟刪除主檔；回 `{ data: { ok: true } }` |

### 估驗計價（`construction.valuation`）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/projects/:projectId/construction-valuations/pcces-lines` | PCCES 明細選擇器；query：`excludeValuationId`（編輯時排除本單）、**`asOfDate=YYYY-MM-DD`**（可選；施工日誌累計算至此 UTC 日曆天**含當日**，省略則**今日 UTC**）；回 `{ data: { pccesImport, rows, groups, items } }`：**`rows`** 為全部工項、**`itemKey` 升序**；末層之 **`logAccumulatedQtyToDate`** 為同 **`itemKey` 跨版** 之 **`dailyQty` 加總**（非僅取單一列 `accumulated`）；並含 `priorBilledQty`、`maxQty`、`suggestedAvailableQty`；非末層上述欄位為 `null`；`items`＝末層子集；**`groups` 為空陣列** |
| GET | `/api/v1/projects/:projectId/construction-valuations` | 分頁列表；query：`page`、`limit` |
| POST | `/api/v1/projects/:projectId/construction-valuations` | 建立；body 見 Zod `constructionValuationCreateSchema`（`lines` 至少一列） |
| GET | `/api/v1/projects/:projectId/construction-valuations/:valuationId` | 單筆；`lines` 依 PCCES 父階重排並含 `pccesParentItemKey`；每列含 `logAccumulatedQtyToDate`（施工日誌 **`dailyQty` 依 itemKey 跨版加總** 至**表頭估驗日（含）**，無表頭則今日 UTC）與 `availableValuationQty`；`lineGroups` 標示區段（`lineStartIndex`／`lineCount`），有父階時 `parent` 帶 (六)(七) 子列加總 |
| PATCH | `/api/v1/projects/:projectId/construction-valuations/:valuationId` | 整張覆寫（含子列） |
| DELETE | `/api/v1/projects/:projectId/construction-valuations/:valuationId` | 軟刪除；回 `{ data: { ok: true } }` |

---

## 四、功能之後慢慢加

- 專案成員（ProjectMember）進階管理與稽核擴充。
- 單租後台、多租後台所需之額外 API。

以上依 `docs/multi-project-multi-tenant-planning.md` 與 `.cursor/rules` 對齊。
