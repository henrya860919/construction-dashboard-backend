# 施工日誌全流程：系統元件盤點與缺口

> 對照 [`construction-daily-log-full-flow-spec.md`](./construction-daily-log-full-flow-spec.md) 與目前 **construction-dashboard-backend / frontend** 實作（約 2026-03）。  
> 「元件」包含：Prisma 模型、後端模組（路由／service／repository）、前端頁面與可複用 UI、權限鍵、依賴套件與背景工作。

**狀態圖例**：✅ 已有且大致可直接沿用 · ⚠️ 有部分基礎，需擴充或與規格對齊 · ❌ 尚未存在 · 🔧 需新增套件／服務

---

## 總覽矩陣

| 規格區塊 | 資料層 (Prisma) | 後端 API／邏輯 | 前端 UI／路由 | 權限模組 |
|----------|-----------------|----------------|---------------|----------|
| PCCES XML 匯入 | ✅ `PccesImport`／`PccesItem` | ✅ `POST/GET/DELETE .../pcces-imports` | ✅ 匯入／列表／明細／刪除版本 | ✅ **`construction.pcces`**（read／create／**delete**；與 `construction.diary` 分離） |
| 契約／工項版本 + 變更紀錄 | ❌ | ❌ | ❌ | ❌（建議 `construction.contract` 或 `management.pcces`） |
| Excel 暫存區／重複偵測 | ❌ | ❌ | ❌ | 同上 |
| 預定進度（兩週節點 + 版本） | ❌ | ❌ | ❌ | 同上或 `construction.diary` 子功能 |
| 停工／工期與預定進度連動 | ⚠️ | ⚠️ | ⚠️ | 既有工期調整 ≠ 規格中的「進度表版本」 |
| 施工日誌主檔／明細（依附表四） | ✅ `ConstructionDailyLog` + 子表 | ✅ `GET/POST/PATCH/DELETE .../construction-daily-logs` | ✅ 列表／新增編輯表單 | ✅ `construction.diary` |
| 人機料（主檔 + 日誌快照） | ⚠️ 僅主檔 | ⚠️ 資源 CRUD | ✅ 資源管理 UI | ✅ 資源相關操作 |
| 估驗 | ❌ | ❌ | ❌ | ❌ |
| 工項進度橫條圖 | ❌（依賴上列資料） | ❌ | ⚠️ 圖表基建有 | 建議與日誌／估驗共用讀取權 |

---

## 一、PCCES XML 匯入

| 元件 | 說明 | 現況 |
|------|------|------|
| **套件** `fast-xml-parser` | 解析 eTender XML（PayItem 遞迴展開、`itemKey` 升冪） | ✅ 已安裝 |
| **Prisma 模型** | `PccesImport`（專案內版本）+ `PccesItem` | ✅ |
| **匯入服務** | 頂層錨定 `itemNo「壹」` 後遞迴子樹；`itemKey` 唯一；親子靠巢狀＋`parentItemKey` | ✅ `pcces-xml-parser.ts` |
| **API** | `GET/POST/DELETE .../pcces-imports`、`GET .../items` | ✅ |
| **列表／詳情筆數** | `itemCount`、`generalCount` 以 **`PccesItem`（未軟刪）即時 `groupBy` 計算**；`PccesImport` 上欄位僅作匯入當下冗餘快取 | ✅ `pcces-import.repository.ts` |
| **儲存** | 原始 XML 歸檔 | ✅ `category=pcces_xml`（失敗不阻擋匯入） |
| **前端** | 匯入頁、版本列表、工項表（分頁／篩選） | ✅ |
| **可複用 UI 概念** | 樹狀展開／扁平列 | ⚠️ `ManagementWbsView` 的樹扁平化、展開狀態可作參考（**資料模型不同**，不宜直接共用元件而不改） |

---

## 二、工項版本管理（線上編輯 + Excel）

| 元件 | 說明 | 現況 |
|------|------|------|
| **版本實體** | `approved_at`、`version`、與工項快照或 delta | ❌ |
| **變更紀錄** | `pcces_item_changes` 同規格 | ❌ |
| **Excel 解析** | `xlsx` / `exceljs` 等 | 🔧 後端 **未**安裝；前端亦無 sheet 函式庫 |
| **暫存區** | staging 表、`expired_at`、hash／指紋去重 | ❌ |
| **API** | 下載範本、上傳、列出 staging、勾選匯入、正式套用新版本 | ❌ |
| **前端** | 樹狀編輯單價／數量、Staging 表格、父層指定（新增列） | ❌ |
| **衝突檢查** | 已完成量 > 新契約量 | ❌（需施工日誌累計 API 就緒後實作） |

---

## 三、預定進度設定

| 元件 | 說明 | 現況 |
|------|------|------|
| **Prisma** | `progress_schedules`、`progress_milestones` | ❌ |
| **服務** | 兩週節點、開竣工映射、內插、`approved_at` 選版 | ❌ |
| **與停工連動** | 停工期水平線、新版進度表 | ⚠️ `ProjectScheduleAdjustment`（展延／停工**申請**）存在，但**無**「預定完成百分比曲線」模型與 API |
| **專案開竣工** | `Project.startDate`、`plannedDurationDays`、`revisedEndDate` 等 | ✅ 已有欄位，可作進度表日曆基準 |
| **前端** | 里程碑表單、版本時間軸、與日誌同日曆 | ❌ |
| **圖表** | 預定 vs 實際折線 | ⚠️ **vue-echarts** 已用於 `MonitoringMetricsView` 等，可複用模式 |

---

## 四、施工日誌

| 元件 | 說明 | 現況 |
|------|------|------|
| **Prisma** | 日誌主檔（日期、狀態、專案）、明細（工項、當日量或累計換算）、人機料**快照**、`log_item_audits` | ❌ |
| **查詢** | 依日累加 `SUM(daily_quantity)`、契約版本有效區間 | ❌ |
| **驗證** | 修改後累計 ≤ 契約量、列出衝突日 | ❌ |
| **API** | CRUD、列表、依日、audit 列表 | ❌ |
| **權限** | `construction.pcces`（匯入）、`construction.diary`（日誌本體） | ✅ 前後端 `permission-modules` 已定義 |
| **桌面頁** | `ConstructionDiaryView.vue` | ⚠️ **占位**；PCCES 區塊依 `useProjectModuleActions(projectId, 'construction.pcces')` |
| **手機頁** | `MobileDiaryView.vue` | ⚠️ **占位**（`MobileNavTabs` 已掛路由） |
| **共用 UI** | 表單、日曆選日、大量工項輸入 | ⚠️ 可沿用 **shadcn-vue**（Input、Table、Dialog）；大量列可參考 **DataTable** 專案慣例 |
| **平台 AuditLog** | 泛用稽核 | ✅ `AuditLog` 表存在；**不**等同規格「逐筆 log_item 數量變更」，領域表仍建議獨立 `log_item_audits` |

---

## 五、人機料（主檔與日誌）

| 元件 | 說明 | 現況 |
|------|------|------|
| **主檔** `ProjectResource` | `labor` / `equipment` / `material` | ✅ Prisma + 專案資源 API／前端管理頁 |
| **與 WBS 連結** | `WbsNodeResource` | ✅ 存在；**施工日誌是否引用 WBS 或純 PCCES** 規格未定，見主規格 §8 |
| **日誌快照** | 寫入當下複製名稱／單位／數量，不隨主檔回溯 | ❌ 需新表（例如 `construction_log_resource_lines`） |

---

## 六、估驗模組

| 元件 | 說明 | 現況 |
|------|------|------|
| **Prisma** | 估驗期別主檔、工項列、已請款累計、與完成量勾稽 | ❌ |
| **邏輯** | 可估驗建議值、上限檢核、父層小計 | ❌ |
| **歷史期初** | 上線前已請款一次匯入 | ❌ |
| **前端** | 估驗表 UI、列印／匯出（若需要） | ❌ |
| **權限** | 建議獨立模組（如 `construction.payment`） | ❌ |

---

## 七、工項進度橫條圖

| 元件 | 說明 | 現況 |
|------|------|------|
| **資料** | 每工項：契約量、累計完成、累計請款 | ❌ 需估驗 + 日誌聚合 API |
| **前端** | 橫向 stacked bar 或自訂 CSS | ⚠️ 無現成「進度條專用元件」；可用 **Tailwind** 寬度條 + **ECharts bar**（專案已依賴 echarts） |
| **路由／導航** | 新專案內頁 | ❌ 需新增 `routes.ts`、`navigation.ts`、`breadcrumb.ts`、權限 |

---

## 八、跨領域／基建（已具備，實作時可直接用）

| 元件 | 用途 |
|------|------|
| **Prisma 7 + PostgreSQL** | 新表、migration、軟刪 `deletedAt` 慣例 |
| **Zod + controller／service／repository** | 新模組結構 |
| **`assertProjectModuleAction` + 模組 ID** | 專案內授權 |
| **Multer 上傳** | XML／Excel 上傳入口 |
| **R2／S3 `storage`** | 匯入檔歸檔（選用） |
| **前端** `buildProjectPath`、`useProjectModuleActions`、**DataTable**、**StateCard**、**vue-echarts** | 列表、KPI、曲線圖 |
| **WBS 樹 UI 經驗** | 類樹狀互動參考（資料需另接 PCCES） |

---

## 九、建議補齊順序（實作路徑）

1. **資料模型優先**：契約版本 + PCCES 工項表（含 `item_key` 錨點）→ 匯入 API → 最簡樹狀唯讀 UI。  
2. **施工日誌 MVP**：日誌主／明細 + 當日量語意 + 累計查詢 + 契約上限驗證 + `log_item_audits`。  
3. **預定進度**：`progress_schedules`／`milestones` + 內插 API，再接到日誌畫面唯讀顯示。  
4. **人機料快照**：掛在日誌明細或子表，讀取 `ProjectResource` 選項。  
5. **估驗**：期別與請款累計 → 與完成量差額邏輯 → 報表／列印可後做。  
6. **Excel 批次變更**：依賴穩定 `item_key` 與版本流程；暫存與 TTL 可最後補。  
7. **橫條圖頁**：完全依賴 2 + 5 的唯讀聚合 API。

---

## 十、文件與程式碼索引（查核用）

| 項目 | 位置 |
|------|------|
| 全流程規格 | `docs/construction-daily-log-full-flow-spec.md` |
| 本盤點 | `docs/construction-daily-log-system-inventory.md` |
| Prisma（專案／WBS／資源／工期調整） | `prisma/schema.prisma`（`Project`、`WbsNode`、`ProjectResource`、`ProjectScheduleAdjustment`） |
| 施工日誌／PCCES 權限鍵 | `construction.diary`（日誌）、`construction.pcces`（XML 匯入）；見 `docs/project-module-permissions.md` |
| 桌面占位 | `construction-dashboard-frontend/src/views/construction/ConstructionDiaryView.vue` |
| 手機占位 | `construction-dashboard-frontend/src/views/mobile/MobileDiaryView.vue` |

---

| 日期 | 說明 |
|------|------|
| 2026-03-21 | 初版：依 repo 搜尋與 schema 對照整理 |
