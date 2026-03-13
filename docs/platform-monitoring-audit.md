# 平台方監控記錄與功能規劃

本文件規劃**平台管理員（platform_admin）**專用功能，分兩部分：

1. **監控記錄**（§1～§6）：登入紀錄、稽核日誌、統計卡片與紀錄列表；所有紀錄**寫入資料庫**，供查詢、篩選與合規使用。
2. **平台方其他功能總覽**（§7）：系統設定、租戶方案與用量、平台公告、系統健康、安全與風控、資料匯出、支援與代管等，一併規劃優先級與實作要點。

---

## 一、目標與範圍

| 項目 | 說明 |
|------|------|
| **對象** | 僅 platform_admin 可存取（路由 `/platform-admin/monitoring/*` 或獨立「監控」區塊）。 |
| **登入紀錄** | 每次登入嘗試（成功／失敗）寫入一筆，含身分、IP、User-Agent、時間。 |
| **稽核日誌** | 關鍵操作（租戶／專案／使用者 CRUD、密碼重設等）寫入一筆，含操作者、動作、資源類型／ID、選填詳情。 |
| **統計卡片** | 儀表板顯示：今日登入次數、今日失敗次數、近 7 日稽核筆數、活躍使用者數等。 |
| **紀錄列表** | 登入紀錄列表、稽核日誌列表，支援分頁與篩選。 |

---

## 二、資料庫設計

### 2.1 登入紀錄（LoginLog）

每次呼叫 `POST /api/v1/auth/login` 不論成功或失敗都寫入一筆，便於稽核與偵測異常登入。

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | String (cuid) | 主鍵 |
| userId | String? (FK → User) | 登入成功時為使用者 ID；失敗時為 null |
| email | String | 登入時使用的 email（成功／失敗皆記錄） |
| success | Boolean | 是否登入成功 |
| ipAddress | String? | 客戶端 IP（從 X-Forwarded-For 或 req.ip） |
| userAgent | String? | User-Agent 字串 |
| failureReason | String? | 失敗時原因（例如 "invalid_password"、"user_not_found"） |
| createdAt | DateTime | 發生時間 |

- **索引**：`createdAt`（依時間查列表）、`email`（查某帳號登入紀錄）、`success`（篩選失敗紀錄）。
- **保留期限**：建議依合規需求訂定（例如 90 天、1 年），可之後加排程刪除過期資料。

**Prisma 範例：**

```prisma
model LoginLog {
  id            String    @id @default(cuid())
  userId        String?   @map("user_id")
  email         String    @map("email")
  success       Boolean   @map("success")
  ipAddress     String?   @map("ip_address")
  userAgent     String?   @map("user_agent")
  failureReason String?   @map("failure_reason")
  createdAt     DateTime  @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([createdAt(sort: Desc)])
  @@index([email])
  @@index([success])
  @@map("login_logs")
}
```

在 `User` 端加上：`loginLogs LoginLog[]`。

---

### 2.2 稽核日誌（AuditLog）

記錄平台或租戶內之關鍵操作，便於事後追蹤「誰在何時對哪個資源做了什麼」。

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | String (cuid) | 主鍵 |
| userId | String? (FK → User) | 操作者 ID；系統或無登入時可為 null |
| action | String | 動作類型（見下表） |
| resourceType | String | 資源類型：tenant | project | user | project_member | attachment | schedule_adjustment 等 |
| resourceId | String? | 受影響資源 ID |
| tenantId | String? | 若操作與租戶相關，記錄租戶 ID 便於篩選 |
| details | Json? | 選填，例如 { "field": "status", "old": "active", "new": "suspended" } 或摘要文字 |
| ipAddress | String? | 請求 IP |
| userAgent | String? | User-Agent |
| createdAt | DateTime | 發生時間 |

**action 建議枚舉（可存字串，前後端對齊）：**

| action | 說明 |
|--------|------|
| tenant.create | 新增租戶 |
| tenant.update | 更新租戶 |
| tenant.delete | 刪除租戶（若實作） |
| project.create | 新增專案 |
| project.update | 更新專案 |
| project.delete | 刪除專案（若實作） |
| user.create | 新增使用者 |
| user.update | 更新使用者 |
| user.password_reset | 重設密碼（平台方） |
| user.delete | 刪除使用者（若實作） |
| project_member.add | 加入專案成員 |
| project_member.remove | 移除專案成員 |
| project_member.role_change | 變更專案角色 |
| attachment.upload | 上傳附件 |
| attachment.delete | 刪除附件 |
| schedule_adjustment.create | 工期調整申請／核定 |

**Prisma 範例：**

```prisma
model AuditLog {
  id           String    @id @default(cuid())
  userId       String?   @map("user_id")
  action       String    @map("action")
  resourceType String    @map("resource_type")
  resourceId   String?   @map("resource_id")
  tenantId     String?   @map("tenant_id")
  details      Json?     @map("details")
  ipAddress    String?   @map("ip_address")
  userAgent    String?   @map("user_agent")
  createdAt    DateTime  @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([createdAt(sort: Desc)])
  @@index([userId])
  @@index([resourceType, resourceId])
  @@index([tenantId])
  @@index([action])
  @@map("audit_logs")
}
```

在 `User` 端加上：`auditLogs AuditLog[]`。

---

### 2.3 小結：是否存資料庫

| 資料 | 是否存 DB | 說明 |
|------|-----------|------|
| 登入紀錄 | ✅ 是 | 需查詢、篩選、統計與合規保留。 |
| 稽核日誌 | ✅ 是 | 同上，且需依資源／租戶／操作類型查詢。 |
| 統計數字 | ❌ 不另建表 | 由登入紀錄／稽核日誌即時聚合（或短週期快取）。 |

---

## 三、API 設計（僅 platform_admin）

Base 路徑：`/api/v1/platform-admin`，所有端點皆需 `authMiddleware` + `requirePlatformAdmin`。

### 3.1 統計（給儀表板卡片用）

| 方法 | 路徑 | 說明 | 回應 |
|------|------|------|------|
| GET | `/platform-admin/monitoring/stats` | 監控統計一包回傳 | 見下方 JSON |

**Query：** 可選 `from`, `to`（ISO 日期）預設為「今日」或「近 7 日」依實作。

**回應範例：**

```json
{
  "data": {
    "login": {
      "todayTotal": 42,
      "todaySuccess": 38,
      "todayFailed": 4,
      "last7DaysTotal": 210,
      "last7DaysFailed": 12
    },
    "audit": {
      "todayCount": 56,
      "last7DaysCount": 312
    },
    "activeUsers": {
      "last24h": 15,
      "last7d": 28
    }
  }
}
```

- `login.*`：由 `LoginLog` 依 `createdAt` 聚合。
- `audit.*`：由 `AuditLog` 依 `createdAt` 聚合。
- `activeUsers`：過去 24h／7d 內有成功登入的**不重複 userId** 數量。

---

### 3.2 登入紀錄列表

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/platform-admin/monitoring/login-logs` | 分頁列表 |

**Query：**

| 參數 | 型別 | 說明 |
|------|------|------|
| page | number | 預設 1 |
| limit | number | 預設 20，最大 100 |
| email | string | 篩選此 email |
| success | boolean | true=僅成功，false=僅失敗 |
| from | string | ISO 日期時間，起始 |
| to | string | ISO 日期時間，結束 |

**回應：** `{ data: LoginLog[], meta: { page, limit, total } }`  
單筆可含關聯 `user` 的 `name`、`systemRole`、`tenantId`（選填）。

---

### 3.3 稽核日誌列表

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/platform-admin/monitoring/audit-logs` | 分頁列表 |

**Query：**

| 參數 | 型別 | 說明 |
|------|------|------|
| page | number | 預設 1 |
| limit | number | 預設 20，最大 100 |
| userId | string | 操作者 ID |
| action | string | 動作類型 |
| resourceType | string | 資源類型 |
| resourceId | string | 資源 ID |
| tenantId | string | 租戶 ID |
| from | string | ISO 日期時間 |
| to | string | ISO 日期時間 |

**回應：** `{ data: AuditLog[], meta: { page, limit, total } }`  
單筆可含關聯 `user` 的 `email`、`name`（選填）。

---

## 四、前端：統計卡片與紀錄列表

### 4.1 監控入口

- 在**平台後台側欄**新增「監控」或「監控記錄」。
- 路徑建議：`/platform-admin/monitoring`（儀表板）＋ `/platform-admin/monitoring/login-logs`、`/platform-admin/monitoring/audit-logs`。

### 4.2 監控儀表板（統計卡片）

- **卡片 1**：今日登入次數（總／成功／失敗）。
- **卡片 2**：近 7 日登入失敗次數（或今日失敗）。
- **卡片 3**：近 7 日稽核筆數（或今日稽核筆數）。
- **卡片 4**：過去 24 小時／7 天活躍使用者數。

資料來源：`GET /api/v1/platform-admin/monitoring/stats`。

### 4.3 登入紀錄列表頁

- 表格欄位：時間、Email、成功／失敗、失敗原因、IP、User-Agent（可摺疊或省略）。
- 篩選：Email、成功／失敗、日期區間。
- 分頁。
- 資料來源：`GET /api/v1/platform-admin/monitoring/login-logs`。

### 4.4 稽核日誌列表頁

- 表格欄位：時間、操作者（email/名稱）、動作、資源類型、資源 ID、租戶（可選）、詳情（details 摘要或 tooltip）。
- 篩選：操作者、動作、資源類型、租戶、日期區間。
- 分頁。
- 資料來源：`GET /api/v1/platform-admin/monitoring/audit-logs`。

---

## 五、實作要點

### 5.1 登入時寫入 LoginLog

- 在 `POST /api/v1/auth/login` 內：
  - **成功**：建立 `LoginLog`（userId=user.id, email, success=true, ip, userAgent）。
  - **失敗**：建立 `LoginLog`（userId=null, email=請求的 email, success=false, failureReason="invalid_password" 或 "user_not_found", ip, userAgent）。
- IP：`req.ip` 或 `req.headers['x-forwarded-for']` 取第一個。
- User-Agent：`req.headers['user-agent']`。

### 5.2 稽核日誌寫入時機

建議以**共用 helper**（例如 `auditLogService.record(req, { action, resourceType, resourceId, tenantId?, details })`）在下列時機呼叫：

| 時機 | action | resourceType | 備註 |
|------|--------|--------------|------|
| 平台新增/更新租戶 | tenant.create / tenant.update | tenant | resourceId = tenant.id |
| 新增/更新/刪除專案（含 admin、platform-admin） | project.create 等 | project | resourceId = project.id, tenantId = project.tenantId |
| 新增使用者、平台重設密碼 | user.create / user.password_reset | user | resourceId = user.id |
| 專案成員新增/移除/改角色 | project_member.add 等 | project_member | resourceId = projectMember.id 或 projectId |
| 附件上傳/刪除 | attachment.upload / attachment.delete | attachment | resourceId = attachment.id, tenantId 從 project 帶入 |
| 工期調整建立/更新 | schedule_adjustment.create 等 | schedule_adjustment | resourceId = adjustment.id |

- `req` 用來取 `req.user.id`、`req.ip`、`req.headers['user-agent']`；若為系統操作則 userId 可為 null。
- 寫入可非同步（不阻塞回應），但需確保寫入失敗有 log，不影響主流程。

### 5.2.1 稽核日誌動作／資源類型中文對照（前端）

後端寫入的 `action`、`resourceType` 為英文代碼；前端稽核日誌列表與篩選需顯示中文。對照表維護於：

- **前端**：`src/constants/audit.ts`
  - `AUDIT_ACTION_LABELS`：action 代碼 → 中文（如 `project.update` → 「更新專案」）
  - `AUDIT_RESOURCE_TYPE_LABELS`：resourceType 代碼 → 中文（如 `project` → 「專案」）

**新增稽核動作時**：後端在對應流程呼叫 `recordAudit` 後，請在 `audit.ts` 的對照表補上一筆，列表與篩選會自動顯示中文；未在對照表中的代碼會直接顯示原字串。

### 5.3 模組結構建議

- **Repository**：`loginLog.repository.ts`、`auditLog.repository.ts`（Prisma 寫入與查詢）。
- **Service**：`loginLog.service.ts`（寫入 + 列表 + 統計）、`auditLog.service.ts`（寫入 + 列表 + 統計）；stats 可合併在一個 `monitoring.service.ts`。
- **Routes**：在 `platform-admin.ts` 下掛 `/monitoring/stats`、`/monitoring/login-logs`、`/monitoring/audit-logs`，或獨立 `platform-admin/monitoring.ts` 再 use。

### 5.4 Migration 與保留政策

- 新增兩個 table 後執行 `npm run db:migrate:dev -- --name add_login_logs_and_audit_logs`。
- 若資料量成長快，可之後加排程：依 `createdAt` 刪除超過 N 天的 `LoginLog`／`AuditLog`，或歸檔到冷儲存。

---

## 六、檢查清單

- [ ] Prisma 新增 `LoginLog`、`AuditLog` 與 User 關聯，並建索引。
- [ ] 執行 migration。
- [ ] 登入 API 成功／失敗皆寫入 `LoginLog`。
- [ ] 實作 `auditLogService.record()` 並在租戶/專案/使用者/成員/附件/工期調整等處呼叫。
- [ ] 後端：`GET /platform-admin/monitoring/stats`、`login-logs`、`audit-logs`。
- [ ] 前端：平台後台側欄「監控」、監控儀表板（統計卡片）、登入紀錄列表、稽核日誌列表。

---

## 七、平台方其他功能總覽與規劃

除前述**監控記錄（登入紀錄、稽核日誌、統計與列表）**外，平台管理員通常還需要下列功能，以下依優先與依賴關係規劃。

### 7.1 功能總覽表

| 功能區塊 | 說明 | 現況 | 優先級 |
|----------|------|------|--------|
| **監控記錄** | 登入紀錄、稽核日誌、統計卡片、列表篩選 | 本文件 §1～§6 已規劃 | 高（先做） |
| **系統／平台設定** | 全平台參數、功能開關、維護模式 | 無 | 高 |
| **租戶方案與用量** | 方案（方案型號）、用量總覽、超用警示 | 僅 Tenant 欄位，無方案與用量儀表板 | 高 |
| **平台公告** | 對全平台或指定租戶發佈公告、維護通知 | 無 | 中 |
| **系統健康與狀態** | API／DB／儲存健康、簡要效能 | 無 | 中 |
| **安全與風控** | 登入鎖定、匯出稽核、IP 黑名單（可選） | 僅 rate limit，無帳號鎖定與匯出 | 中 |
| **資料匯出與合規** | 租戶資料匯出、稽核匯出、保留政策 | 無 | 中 |
| **支援與代管** | 代為操作（impersonation）、工單連結（可選） | 無 | 低／選配 |

---

### 7.2 系統／平台設定

**目的**：全平台共用參數、功能開關、維護模式，不依租戶而異。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **維護模式** | 開關後，非 platform_admin 一律回 503 或固定維護頁 | 設定存 DB 或 env；middleware 檢查 |
| **功能開關** | 例如：是否開放「某模組」、是否開放「註冊」 | 表 `PlatformSetting` key-value 或 JSON；API `GET /platform-admin/settings`、`PATCH`（僅 platform_admin） |
| **預設限制** | 新租戶預設的 userLimit、storageQuotaMb、fileSizeLimitMb | 可放在 PlatformSetting 或 env，建立 Tenant 時套用 |
| **全站文案** | 登入頁公告、footer 連結等 | key-value 或 JSON，前端由 API 或 SSR 讀取 |

**資料庫**：可新增 `PlatformSetting`（key 唯一、value 文字或 JSON），或先用 env + 之後遷移。

---

### 7.3 租戶方案與用量

**目的**：讓平台方一眼看到各租戶「方案」與「用量」，方便續約、升級與超用處理。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **方案（Plan）** | 例如免費版／專業版／企業版，對應 userLimit、storageQuotaMb、功能開關 | 表 `Plan`（id, name, slug, userLimit, storageQuotaMb, fileSizeLimitMb, features JSON）；Tenant 加 `planId`（可選） |
| **租戶用量總覽** | 各租戶：使用者數、專案數、儲存用量、是否接近／超過配額 | 現有 Tenant 已有 _count、storage 可查；API `GET /platform-admin/tenants` 擴充回傳用量，或 `GET /platform-admin/usage/overview` |
| **用量儀表板** | 平台總使用者數、總專案數、總儲存、趨勢（可選） | 由既有資料聚合；`GET /platform-admin/monitoring/stats` 可擴充「全平台用量」區塊 |
| **超用／到期警示** | 列表標示「已超用」「即將到期」 | 前端依 tenant.storageQuotaMb、expiresAt 與實際用量計算並顯示 |

**資料庫**：Tenant 已有 userLimit、storageQuotaMb、expiresAt；若要做方案則加 Plan 表與 Tenant.planId。

---

### 7.4 平台公告

**目的**：對全平台或指定租戶發佈維護通知、政策變更等。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **公告 CRUD** | 標題、內容、發佈時間、下架時間、對象（全平台／指定 tenantIds） | 表 `PlatformAnnouncement`（id, title, body, publishedAt, expiresAt, targetTenantIds JSON 或關聯表） |
| **列表與篩選** | 平台後台「公告管理」列表、依狀態／時間篩選 | `GET /platform-admin/announcements` 分頁 |
| **前端顯示** | 登入後或工作區頂部 banner／彈窗，僅顯示未過期且對象包含當前租戶的公告 | `GET /api/v1/announcements/active`（依 JWT tenantId 過濾），不需 platform_admin |

**資料庫**：`PlatformAnnouncement`；若對象為「全平台」可用 targetTenantIds=null 或空陣列表示。

---

### 7.5 系統健康與狀態

**目的**：平台方快速確認 API、DB、儲存是否正常，必要時提供公開狀態頁。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **健康檢查** | DB 連線、儲存（R2/S3）連線、必要時 Redis 等 | 現有或新增 `GET /api/health`（可區分 public / platform-admin 詳細版） |
| **平台後台「系統狀態」頁** | 顯示：DB 延遲、儲存可寫性、最近錯誤數（可選） | `GET /platform-admin/system/status` 回傳各元件狀態與簡要指標 |
| **簡要效能** | 最近 N 分鐘請求數、平均回應時間（若有 middleware 紀錄） | 可選；需 request log 或 APM，非必須第一版 |

---

### 7.6 安全與風控

**目的**：降低暴力破解、濫用與帳號盜用風險，並支援合規查詢。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **登入失敗鎖定** | 同一 email 或 IP 在 N 分鐘內失敗 M 次則暫時拒絕登入 | 依 LoginLog 查詢或記憶體/Redis 計數；鎖定時間到自動解除或 platform_admin 手動解除 |
| **帳號鎖定／停用** | 平台方手動鎖定某 User（禁止登入） | User 加欄位 `lockedAt` 或 `status`；登入時檢查 |
| **稽核日誌匯出** | 依時間／租戶／操作類型匯出 CSV 或 JSON | `GET /platform-admin/monitoring/audit-logs?format=csv` 或專用 export API，僅 platform_admin |
| **登入紀錄匯出** | 同上，供資安或合規 | `GET /platform-admin/monitoring/login-logs?format=csv` |
| **IP 黑名單（可選）** | 拒絕特定 IP 登入或存取 | 表或設定檔；auth middleware 檢查 |

---

### 7.7 資料匯出與合規

**目的**：支援租戶資料攜帶、合規審計與保留政策。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **租戶資料匯出** | 應租戶要求匯出其專案、成員、附件清單等（不含實體檔或含連結） | `POST /platform-admin/tenants/:id/export` 觸發非同步任務，完成後提供下載連結或通知 |
| **稽核／登入紀錄保留政策** | 自動刪除或歸檔超過 N 天的紀錄 | 排程 job 依 `createdAt` 刪除或搬移到歸檔表／冷儲存 |
| **合規文件** | 隱私政策、使用條款、資料處理說明 | 靜態頁或 CMS；可放 PlatformSetting 連結 |

---

### 7.8 支援與代管（選配）

**目的**：客服或營運代租戶操作、排查問題時使用；涉及隱私與合規，需謹慎。

| 項目 | 說明 | 實作要點 |
|------|------|----------|
| **代為登入（Impersonation）** | platform_admin 以某租戶使用者身份進入系統操作 | 發放短期 token 標記為 impersonation，前端顯示「目前代管中」；所有寫入仍記為被代管者或另記「代管者」於 audit |
| **操作紀錄** | 代管期間操作寫入稽核且標註「由 platform_admin A 代管 user B」 | AuditLog.details 或專用欄位 |
| **工單／支援連結** | 租戶後台「聯絡支援」連到外部工單系統或 email | 設定連結即可，不需必備 |

---

### 7.9 平台後台側欄與頁面規劃

以下為**側欄結構**、**路由與頁面一覽**、**麵包屑與常數**，以及**前端檔案對照**，供實作時直接對齊。

#### 7.9.1 側欄結構

平台後台目前為**扁平列表**（`PLATFORM_ADMIN_SIDEBAR_ENTRIES`）；若之後要加分組標題，可改為 `PLATFORM_ADMIN_SIDEBAR_GROUPS`（結構同專案內 `NavGroup`）。

**方案 A：扁平列表（與現有寫法一致）**

依顯示順序列出所有側欄項目，直接擴充 `PLATFORM_ADMIN_SIDEBAR_ENTRIES`：

| 順序 | id | label | path | icon（Lucide 名稱） |
|------|-----|-------|------|---------------------|
| 1 | platform-tenants | 租戶管理 | /platform-admin/tenants | Building2 |
| 2 | platform-projects | 專案總覽 | /platform-admin/projects | FolderKanban |
| 3 | platform-users | 使用者總覽 | /platform-admin/users | Users |
| 4 | platform-monitoring | 監控儀表板 | /platform-admin/monitoring | Activity |
| 5 | platform-login-logs | 登入紀錄 | /platform-admin/monitoring/login-logs | LogIn |
| 6 | platform-audit-logs | 稽核日誌 | /platform-admin/monitoring/audit-logs | FileText |
| 7 | platform-usage | 用量總覽 | /platform-admin/usage | BarChart3 |
| 8 | platform-announcements | 平台公告 | /platform-admin/announcements | Megaphone |
| 9 | platform-settings | 平台設定 | /platform-admin/settings | Settings |
| 10 | platform-system | 系統狀態 | /platform-admin/system | Server |

**方案 B：分組（選用）**

若側欄要顯示「租戶與組織」「監控」「營運」「系統」等分組，可定義 `PLATFORM_ADMIN_SIDEBAR_GROUPS`（型別同 `NavGroup`：`{ id, label, children: NavItem[] }`），並在 `AppSidebar.vue` 的 platform 區塊改為迴圈 groups + children：

| 群組 id | 群組 label | 子項（id, label, path, icon） |
|---------|------------|-------------------------------|
| org | 租戶與組織 | platform-tenants 租戶管理、platform-projects 專案總覽、platform-users 使用者總覽 |
| monitoring | 監控 | platform-monitoring 監控儀表板、platform-login-logs 登入紀錄、platform-audit-logs 稽核日誌 |
| ops | 營運 | platform-usage 用量總覽、platform-announcements 平台公告 |
| system | 系統 | platform-settings 平台設定、platform-system 系統狀態 |

**icon 建議**：Building2, FolderKanban, Users, Activity, LogIn, FileText, BarChart3, Megaphone, Settings, Server（皆為 lucide-vue-next 名稱，需在 AppSidebar 的 ICON_MAP 補齊）。

---

#### 7.9.2 路由與頁面一覽

| 路徑 | name（ROUTE_NAME） | 對應 View 元件 | 說明 |
|------|-------------------|----------------|------|
| /platform-admin | — | redirect → /platform-admin/tenants | 預設進入租戶管理 |
| /platform-admin/tenants | platform-admin-tenants | PlatformTenantsView.vue | 租戶列表（既有） |
| /platform-admin/tenants/:tenantId | platform-admin-tenant-manage | PlatformTenantManageView.vue | 單一租戶管理（既有） |
| /platform-admin/projects | platform-admin-projects | PlatformProjectsView.vue | 專案總覽（既有） |
| /platform-admin/users | platform-admin-users | PlatformUsersView.vue | 使用者總覽（既有） |
| /platform-admin/monitoring | platform-admin-monitoring | PlatformMonitoringView.vue | 監控儀表板（統計卡片） |
| /platform-admin/monitoring/login-logs | platform-admin-login-logs | PlatformLoginLogsView.vue | 登入紀錄列表 |
| /platform-admin/monitoring/audit-logs | platform-admin-audit-logs | PlatformAuditLogsView.vue | 稽核日誌列表 |
| /platform-admin/usage | platform-admin-usage | PlatformUsageView.vue | 用量總覽（各租戶用量／超用／到期） |
| /platform-admin/announcements | platform-admin-announcements | PlatformAnnouncementsView.vue | 平台公告列表與 CRUD |
| /platform-admin/settings | platform-admin-settings | PlatformSettingsView.vue | 平台設定（維護模式、功能開關等） |
| /platform-admin/system | platform-admin-system | PlatformSystemView.vue | 系統狀態（健康檢查、簡要效能） |

**安全相關**（帳號鎖定、稽核／登入匯出）可放在「監控」底下：或於監控儀表板／登入紀錄／稽核日誌頁內提供按鈕或 Tab，不另開頂層路由。

---

#### 7.9.3 麵包屑與常數對照

**BREADCRUMB_LABELS**（平台後台相關 path → 顯示名稱）：

| path | 麵包屑顯示 |
|------|------------|
| /platform-admin | 平台管理 |
| /platform-admin/tenants | 租戶管理 |
| /platform-admin/tenants/:tenantId | 租戶管理（詳情頁用「租戶名稱」或維持「租戶管理」） |
| /platform-admin/projects | 專案總覽 |
| /platform-admin/users | 使用者總覽 |
| /platform-admin/monitoring | 監控儀表板 |
| /platform-admin/monitoring/login-logs | 登入紀錄 |
| /platform-admin/monitoring/audit-logs | 稽核日誌 |
| /platform-admin/usage | 用量總覽 |
| /platform-admin/announcements | 平台公告 |
| /platform-admin/settings | 平台設定 |
| /platform-admin/system | 系統狀態 |

**ROUTE_PATH**（建議常數，與 router 一致）：

```ts
// 在 ROUTE_PATH 中新增
PLATFORM_ADMIN_MONITORING: '/platform-admin/monitoring',
PLATFORM_ADMIN_LOGIN_LOGS: '/platform-admin/monitoring/login-logs',
PLATFORM_ADMIN_AUDIT_LOGS: '/platform-admin/monitoring/audit-logs',
PLATFORM_ADMIN_USAGE: '/platform-admin/usage',
PLATFORM_ADMIN_ANNOUNCEMENTS: '/platform-admin/announcements',
PLATFORM_ADMIN_SETTINGS: '/platform-admin/settings',
PLATFORM_ADMIN_SYSTEM: '/platform-admin/system',
```

**ROUTE_NAME**（建議常數）：

```ts
PLATFORM_ADMIN_MONITORING: 'platform-admin-monitoring',
PLATFORM_ADMIN_LOGIN_LOGS: 'platform-admin-login-logs',
PLATFORM_ADMIN_AUDIT_LOGS: 'platform-admin-audit-logs',
PLATFORM_ADMIN_USAGE: 'platform-admin-usage',
PLATFORM_ADMIN_ANNOUNCEMENTS: 'platform-admin-announcements',
PLATFORM_ADMIN_SETTINGS: 'platform-admin-settings',
PLATFORM_ADMIN_SYSTEM: 'platform-admin-system',
```

**預設 redirect**：`/platform-admin` → 可維持現有 `ROUTE_PATH.PLATFORM_ADMIN_TENANTS`（租戶管理），或改為 `PLATFORM_ADMIN_MONITORING`（監控儀表板），依產品偏好。

---

#### 7.9.4 前端檔案對照（實作時需修改）

| 檔案 | 修改內容 |
|------|----------|
| **src/constants/navigation.ts** | 擴充 `PLATFORM_ADMIN_SIDEBAR_ENTRIES`（或新增 `PLATFORM_ADMIN_SIDEBAR_GROUPS`），加入監控、用量、公告、設定、系統等項目。 |
| **src/constants/routes.ts** | 新增 `ROUTE_PATH`、`ROUTE_NAME` 平台監控／用量／公告／設定／系統。 |
| **src/constants/breadcrumb.ts** | 新增上表所列 path 的 `BREADCRUMB_LABELS`。 |
| **src/router/index.ts** | 新增 platform-admin 下各 path 的 route（component 對應上表 View）。 |
| **src/components/common/AppSidebar.vue** | 若用分組則改為迴圈 `PLATFORM_ADMIN_SIDEBAR_GROUPS`；並在 `ICON_MAP` 補齊 LogIn、BarChart3、Megaphone、Server 等 icon。 |
| **src/views/platform-admin/** | 新增：PlatformMonitoringView.vue、PlatformLoginLogsView.vue、PlatformAuditLogsView.vue、PlatformUsageView.vue、PlatformAnnouncementsView.vue、PlatformSettingsView.vue、PlatformSystemView.vue。 |

**API 常數**（`src/constants/api.ts`）：新增 platform-admin monitoring / usage / announcements / settings / system 的 API path（與後端 `/api/v1/platform-admin/...` 對齊）。

---

### 7.10 實作順序建議

| 階段 | 內容 |
|------|------|
| 1 | 監控記錄：LoginLog / AuditLog、stats、列表與篩選（§1～§6）；**前端**側欄與頁面依 **§7.9** 新增監控儀表板、登入紀錄、稽核日誌（routes、views、breadcrumb、navigation）。 |
| 2 | 平台設定：維護模式、功能開關、預設限制（DB 或 env）；前端新增「平台設定」頁與側欄項目（§7.9）。 |
| 3 | 租戶用量總覽：擴充租戶列表或獨立用量頁、超用／到期標示；前端新增「用量總覽」頁與側欄（§7.9）。 |
| 4 | 安全：登入失敗鎖定、稽核／登入紀錄匯出（可放在既有監控頁內）。 |
| 5 | 平台公告、系統狀態、方案（Plan）與進階用量；前端新增公告、系統狀態頁與側欄（§7.9）。 |
| 6 | 資料匯出、代管（依需求再評估） |

---

## 八、與既有文件對照

| 項目 | 參考 |
|------|------|
| 多租後台路由 | `src/routes/platform-admin.ts` |
| 認證與 platform_admin | `src/middleware/auth.ts` |
| 平台監控差距說明 | `docs/multi-tenant-and-product-gap-analysis.md`（稽核日誌一節） |
| 租戶與配額 | `prisma/schema.prisma`（Tenant）、`docs/file-upload.md` |
