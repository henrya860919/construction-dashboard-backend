# 多租戶管理、客戶端部署與產品差距分析

本文件整理：(1) 目前多租戶機制與各租戶使用現況；(2) 客戶端（如台灣單一客戶）部署時是否需獨立 branch 及單租考量；(3) 與大廠工程管理產品相比，功能與架構上的差距與建議。

---

## 一、目前多租戶管理與各租戶使用現況

### 1.1 資料模型與角色

| 概念 | 現況 |
|------|------|
| **Tenant（租戶）** | 一公司／一組織單位；Schema 含 `name`、`slug`、`status`、`expiresAt`、`userLimit`、`fileSizeLimitMb`、`storageQuotaMb`。 |
| **User 所屬** | `User.tenantId` 可為 null（如 platform_admin）；一般使用者隸屬單一租戶。 |
| **Project 所屬** | `Project.tenantId` 可為 null；多租時專案隸屬某租戶。 |
| **系統角色** | `platform_admin`（跨租戶）、`tenant_admin`（單一租戶管理）、`project_user`（專案層）。 |
| **專案角色** | `ProjectMember.role`：`project_admin`、`member`、`viewer`。 |

### 1.2 後台分層

| 後台類型 | 對象 | 入口 | 功能 |
|----------|------|------|------|
| **單租後台** | tenant_admin（租戶／公司管理員） | `/admin/*`（側欄「後台管理」） | 租戶資訊、專案管理、成員管理、公司設定；僅操作「本租戶」資料。 |
| **多租後台** | platform_admin | `/platform-admin/*`（登入後直接進租戶列表） | 租戶 CRUD、專案總覽、使用者總覽；可選 tenantId 篩選、重設密碼等。 |

### 1.3 API 與權限要點

- **專案列表** `GET /api/v1/projects`：依登入者過濾 — platform_admin 看全部；tenant_admin / project_user 僅看 `user.tenantId` 下或自身為 ProjectMember 的專案。
- **專案 CRUD / 專案內資源**：皆檢查專案是否屬於使用者租戶（或 platform_admin 放行）；檔案上傳另做 Tenant 配額（單檔／總儲存）。
- **Admin API**（`/api/v1/admin/*`）：tenant_admin 僅本租戶；platform_admin 可帶 `?tenantId=` 操作指定租戶。
- **Platform Admin API**（`/api/v1/platform-admin/*`）：僅 platform_admin；租戶 CRUD、全平台專案／使用者查詢。

### 1.4 各租戶實際使用流程

1. **租戶管理員（tenant_admin）**：登入 → 專案列表（僅本租戶）→ 選專案進工作區（儀表板／監測／契約）→ 或進「後台管理」管專案、成員、租戶資訊。
2. **專案層（project_user）**：登入 → 專案列表（僅被加入的專案）→ 選專案進工作區；無後台入口。
3. **平台管理員（platform_admin）**：登入 → 直接進「租戶管理」→ 可切換檢視各租戶、專案總覽、使用者總覽；若需以「單租視角」操作，需先選租戶再進單租後台（目前需手動選 tenant 後進 `/admin`，依實作而定）。

### 1.5 小結

- 多租戶已貫穿：Tenant、User、Project、Attachment、權限與配額。
- 單租後台與多租後台並存；前端依 `systemRole` 與 route 顯示不同側欄與入口。
- 無租戶時：`User.tenantId` / `Project.tenantId` 可為 null；專案列表會過濾（非 platform_admin 且無 tenantId 則列表為空）。

---

## 二、客戶端部署（如台灣單一客戶）是否要切 Branch？

### 2.1 情境

- **多租 SaaS**：一套系統多公司，需租戶隔離、平台方營運後台。
- **客戶端／單一客戶（如台灣某業主或營造）**：只服務一家公司，不需要「多租戶」概念，也不希望出現「租戶管理」「選租戶」等 UI。

### 2.2 是否一定要獨立 Branch？

**結論：不必然要長期獨立 branch，可優先以「同一 codebase + 設定／編譯開關」達成單租客製。**

| 做法 | 優點 | 缺點 |
|------|------|------|
| **A. 獨立 branch（如 `release/tw-client`）** | 可大膽刪除多租 UI、API，程式最簡。 | 與主線脫節，合併成本高；雙線維護。 |
| **B. 同一 repo + 環境／編譯開關（建議）** | 單一主線、功能可選；單租僅隱藏 UI／跳過多租邏輯。 | 需紀律：多租相關改動都要用開關包住或相容 null tenant。 |

### 2.3 建議：Feature flag / 建置開關

- **後端**：例如 `DISABLE_MULTI_TENANT=true` 或 `TENANT_MODE=single` 時：
  - 登入後一律視為「單一邏輯租戶」（可固定一個 tenantId 或全用 null）。
  - 若保留單一 Tenant 記錄，則專案列表、Admin API 不再需要「選租戶」；platform_admin 可選擇隱藏或改為「系統設定」角色。
- **前端**：例如 `VITE_TENANT_MODE=single`（或依後端 config 回傳）：
  - 不顯示「租戶管理」「選租戶」相關選單與頁面（`/platform-admin/tenants`、租戶選擇器等）。
  - 單租後台仍可保留（專案管理、成員管理、公司設定），僅改文案為「公司」而非「租戶」。

這樣**不需要**在客戶端 branch 刪掉 Tenant 表或 API，只是不暴露多租介面與流程；未來若該客戶要擴成多分公司，可再開關打開。

### 2.4 若仍要獨立 Branch 的情境

- 客戶有**強烈客製**（例如法規、在地流程、完全不同的模組組合），且不打算回饋主線。
- 希望**徹底移除**多租程式碼以減少 bundle 與維護面，且可接受長期 fork。

此時可從「開關版」主線切出 `release/xx-client`，在該 branch 做刪減與客製，並訂好與主線的 sync 策略（例如只 cherry-pick 修復、不反向合併）。

### 2.5 實作檢查清單（單租模式）

- [ ] 後端：讀取 `TENANT_MODE` 或等同開關；單租時專案列表／Admin 不依 tenantId 篩選（或固定單一 tenant）。
- [ ] 前端：依 build/env 或 API 回傳隱藏「租戶管理」、平台方選租戶 UI。
- [ ] 登入後導向：單租時 platform_admin 可改導向專案列表或單租後台，而非租戶列表。
- [ ] 文案：單租版將「租戶」改為「公司」或「組織」（可 i18n key 區分）。

---

## 三、與大廠產品相比：功能與架構差距

對照 Procore、Autodesk Build（Autodesk Construction Cloud）等建案／工程管理平台，整理本專案**已有**與**尚缺**的功能與架構，供產品與開發排程參考。

### 3.1 本專案現有功能概覽

| 領域 | 現有功能 |
|------|----------|
| **身分與權限** | 多租戶、三層角色（platform / tenant / project）、專案成員與角色（admin / member / viewer）。 |
| **專案** | 專案 CRUD、專案基本資訊（設計/監造/施工、開竣工日、負責人等）、專案列表與入口。 |
| **概況** | 儀表板、大事記、里程碑。 |
| **監測** | 歷史數據、數據上傳、設備、影像、報表。 |
| **契約** | 專案資訊、工期調整（展延／停工申請與核定）、契約管理（含檔案）。 |
| **檔案** | 附件上傳、依專案＋租戶儲存、租戶單檔／總量配額。 |
| **後台** | 單租後台（租戶資訊、專案管理、成員管理、公司設定）、多租後台（租戶 CRUD、專案總覽、使用者總覽）。 |

### 3.2 大廠常見模組與本專案差距

（以下「大廠」以 Procore、Autodesk Build 等為參考。）

| 大廠模組／能力 | 說明 | 本專案現況 | 建議優先級 |
|----------------|------|------------|------------|
| **RFI（Request for Information）** | 正式請求釋疑流程、回覆追蹤、可連結變更與成本。 | 無獨立模組 | 高（工程協調核心） |
| **Submittals（送審管理）** | 送審件提交、審核流程、狀態追蹤。 | 無 | 高 |
| **變更／變更令（Change Orders）** | 變更申請、核定、與預算/成本連動。 | 僅工期調整，無一般變更令與成本連動 | 高 |
| **成本／預算（Cost / Budget）** | 預算編列、實際成本、請款、與變更令連動。 | 無 | 高（若要走完整工程管理） |
| **BIM / 設計協同** | 模型檢視、碰撞檢測、設計版本。 | 無 | 中（依客戶類型） |
| **每日日誌（Daily Log）** | 日報、氣象、工種、人力機具。 | 無 | 中 |
| **圖說／文件版本** | 圖說上傳、版次、批註、分發。 | 僅一般附件，無版次與圖說專用流程 | 中 |
| **安全／工安（Safety）** | 事故通報、檢查、教育訓練紀錄。 | 無 | 中 |
| **招標／投標（Bid Management）** | 招標案、投標、評選。 | 無 | 低（視產品定位） |
| **行動 App / 離線** | 現場填報、離線暫存、同步。 | 未見專用行動版／離線 | 中（現場使用體驗） |
| **稽核與合規** | 操作日誌、誰在何時改什麼、合規報告。 | 無完整 audit log | 中 |
| **報表與儀表板** | 跨專案報表、自訂 KPI、匯出。 | 有基礎儀表板與報表，跨專案與自訂較少 | 中 |
| **整合與 API** | 與 ERP、會計、排程軟體整合；開放 API。 | 未見對外開放 API 文件與 webhook | 中 |
| **多語言 / 在地化** | 多語系、在地法規與欄位。 | 未見完整 i18n／在地化 | 依客戶 |

### 3.3 架構與營運面差距

| 項目 | 大廠常見做法 | 本專案現況 | 建議 |
|------|--------------|------------|------|
| **租戶隔離** | 資料與儲存嚴格隔離（row-level 或 schema/DB per tenant） | 已做 row-level（tenantId）、儲存路徑含 tenantId | 維持；若有法規需求再考慮 DB per tenant |
| **計費與方案** | 依方案開功能、限使用者數/專案數/儲存。 | Tenant 有 userLimit、storageQuotaMb、fileSizeLimitMb，未與計費串接 | 可補「方案／功能開關」與計費系統整合 |
| **SSO / 企業登入** | SAML、OAuth、LDAP。 | 未見 | 企業客戶常需，可列中長期 |
| **高可用與 SLA** | 多區、備援、SLA 承諾。 | 依 Railway 等既有部署 | 隨客戶規模規劃 |
| **合規與資安** | SOC2、ISO、個資與資安規範。 | 有基本安全與依賴檢查（見 security-dependencies.md） | 若有企業客戶需補文件與流程 |

### 3.4 小結與建議順序

- **已有**：多租戶架構、角色與權限、專案與專案內概況／監測／契約、檔案與配額、單租／多租後台。
- **建議優先補齊（與大廠對齊核心流程）**：  
  RFI、Submittals、變更令與成本預算的基礎、每日日誌、圖說版次、稽核日誌。  
- **同一 codebase 單租客戶端**：用設定／開關隱藏多租 UI 與流程，不必強制獨立 branch；若有重度客製再考慮 release branch。

---

## 四、文件與程式對照

| 主題 | 參考文件／程式 |
|------|----------------|
| 多專案／多租戶架構規劃 | 前端 `docs/multi-project-multi-tenant-planning.md` |
| 後端 Prisma 與 API | `docs/backend-prisma-api.md`、`prisma/schema.prisma` |
| 檔案上傳與租戶配額 | `docs/file-upload.md` |
| 後台 API | `src/routes/admin.ts`、`src/routes/platform-admin.ts` |
| 權限與角色 | `src/middleware/auth.ts`、`src/modules/project/project.service.ts` |

---

*本文件為產品與架構分析，實作細節以程式碼與上述文件為準。*
