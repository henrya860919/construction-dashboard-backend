# 施工日誌完整流程規格

> 本文件彙整 PCCES 匯入、契約變更版本、預定進度、施工日誌、估驗與工項進度視覺化之端到端邏輯，並附**實作時建議對齊事項**（與既有 Prisma／專案模組銜接時請一併檢視）。

**相關**：[系統元件盤點與缺口](./construction-daily-log-system-inventory.md)（與目前前後端 repo 對照、需補套件與建議實作順序）。

---

## 目錄

1. [PCCES XML 匯入](#一-pcces-xml-匯入)
2. [工項版本管理（契約變更）](#二-工項版本管理契約變更)
3. [預定進度設定](#三-預定進度設定施工日誌前提一)
4. [施工日誌](#四-施工日誌)
5. [估驗模組](#五-估驗模組)
6. [工項進度橫條圖](#六-工項進度橫條圖獨立頁面)
7. [待確認與後續事項](#七-待確認與後續事項)
8. [設計審閱重點（建議）](#八-設計審閱重點建議)

---

## 一、PCCES XML 匯入

### 1.1 背景

- 廠商得標後，由 PCCES 系統產出 XML 檔案（標準 schema：`http://pcstd.pcc.gov.tw/2003/eTender`）。
- XML 為巢狀 `PayItem` **樹狀結構**，層數不固定（約 2～6 層）。
- `documentType` 可能為 `budget` 或 `contract`（匯入時需決定是否分開儲存或標記來源）。

### 1.2 XML 結構關鍵欄位

| 欄位 | 說明 |
|------|------|
| `itemKey` | 檔內唯一識別碼（實務上建議以字串讀入再正規化，避免超大數或前導零問題） |
| `itemNo` | 層級編號（壹／一／(一)／[一]／1 等） |
| `itemKind` | `mainItem`（父層）／`general`（葉節點，**可施工項目**） |
| `refItemCode` | PCCES 料號（格式因業主而異，需 `.trim()`） |
| `Description` | 工項說明（建議取 `language="zh-TW"`） |
| `Unit` / `Quantity` / `Price` / `Amount` | 單位、數量、單價、複價 |
| `Remark` / `Percent` | 備註、百分比（有則寫入 DB） |

### 1.3 解析套件（後端）

```bash
npm install fast-xml-parser
```

### 1.4 解析策略

- **匯入範圍**：只在 `DetailList` **頂層** `PayItem` 中尋找 `itemNo ===「壹」`（且 `itemKind` 為 `mainItem`／`general`）作為根，**僅遞迴該節點底下子樹**寫入 DB。`itemNo` 在不同父層會重複（例如「壹」「伍」底下各有「一、二、三」），**不可用 `itemNo` 做跨分支識別**；階層與親子關係一律以 **`itemKey`／巢狀 `PayItem`／遞迴時維護的 `parentItemKey`** 為準。
- 遞迴走訪上述子樹內所有 `PayItem`，累積**麵包屑路徑**（供顯示與匯總階層）。
- **僅** `itemKind === 'general'` 的葉節點為「可填施工日誌／估驗」的工項；`mainItem` 作為路徑與階層小計節點（匯入時仍一併儲存，供複價 rollup 與父階顯示）。
- 父層金額小計不人工維護「與 XML 完全一致」，改由系統自葉節點加總（若需與 PCCES 書面完全一致，需另存「匯入時 XML 複價」作對照欄，見 §8）。

### 1.5 解析實作（正式程式碼）

後端實作見 **`src/modules/pcces-import/pcces-xml-parser.ts`**（`fast-xml-parser`）。

- **Parser 選項**：`ignoreAttributes: false`、`attributeNamePrefix: '@_'`、`isArray: (name) => ['PayItem','Description','Unit'].includes(name)`、`removeNSPrefix: true`
- **入口**：自解析結果遞迴尋找 `ETenderSheet` → `DetailList.PayItem` → 頂層錨定「壹」後再扁平化，層數不寫死。
- **扁平化**：每個 `PayItem` 一列，`parentItemKey` 指父節點 `itemKey`（「壹」根列為 `null`）；`mainItem` 與 `general` 皆寫入。
- **欄位**：`Description`／`Unit` 取 `zh-TW`；`Price`／`Amount`／`Quantity` 支援純數字或 `{ '#text': '...' }`；另解析 **`Remark`**、**`Percent`**。
- **階層金額計算**（寫入 DB 前，`pcces-amount-rollup.ts`）：`general` 之複價 = **數量 × 單價**（`Decimal(18,4)` 四捨五入）；`mainItem` 之複價 = **直接子列複價加總**，單價 = **複價 ÷ 數量**（數量 > 0；與 §1.8 父層由子項加總對齊）。匯入後列表／明細以計算值為準，不再沿用 XML 之 `Amount`／父層 `Price` 原字串。
- **排序**：寫入前依 **`itemKey` 升冪** 排序並檢查唯一性。

### 1.6 已知問題與處理方式

| 問題 | 處理方式 |
|------|----------|
| `refItemCode` 有空白 padding | `.trim()` 後判斷是否空字串 |
| `refItemCode` 長度因業主不同（10／12／13 碼等） | 存**原始字串**，不在系統內強制正規化 |
| `itemNo` 符號不統一 | 以 **`depth`（樹深度）** 判斷層級，不依賴編號字元規則 |
| 環南等大型工程出現 `analysis`／`variablePrice` 等 | 匯入階段可過濾，只保留 `mainItem` 與 `general`（需文件化例外清單） |
| `Description` 多語系 | `find(d => d.$.language === 'zh-TW')`，無則 fallback 政策需定義 |
| namespace | `removeNSPrefix: true`（fast-xml-parser） |
| 數量／單價欄位可能為空 | `?? 0` 防呆；匯入報告需列出「被置 0 的欄位」供人工複核 |

### 1.7 DB 結構（概念草案）

以下為**概念 SQL**，實作時應改寫為 Prisma model，並與本專案之 `Project`、軟刪除、`project_id` 型別等既有慣例對齊。

```sql
CREATE TABLE pcces_items (
  id              SERIAL PRIMARY KEY,
  project_id      INT REFERENCES projects(id),
  item_key        INT,
  parent_item_key INT,
  item_no         VARCHAR(20),
  item_kind       VARCHAR(30),
  ref_code        VARCHAR(20),
  description     TEXT,
  unit            VARCHAR(10),
  quantity        NUMERIC,
  unit_price      NUMERIC,
  -- 選項 A：與 XML 一致保存複價（可能與 qty * price 因四捨五入不一致）
  amount_imported NUMERIC,
  -- 選項 B：僅存 qty/price，amount 一律由 DB 或應用層計算
  -- amount          NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  path            TEXT,
  depth           INT
);
```

### 1.8 父層小計

- **葉節點**：數量／單價以契約版本為準；複價可為匯入值或計算值（擇一為主，另一作核對）。
- **父層**：建議以 **Recursive CTE** 或**物化快取**（背景 job 更新）對子項加總，避免與 Excel／線上編輯並行時不一致。
- 若採 **GENERATED COLUMN** 的 `amount = quantity * unit_price`，需確認**父層列**在 XML 中是否總有合理 `quantity`／`price`，否則僅適用於葉節點或需分表。

---

## 二、工項版本管理（契約變更）

### 2.1 版本概念

- **v1**：XML 匯入（原始合約）。
- **v2, v3…**：每次契約變更核定後之新版本。
- 每版具 **`approved_at`（核定日期）**：決定自何日起適用（與施工日誌日期、估驗期別對齊）。

> **與 §1 的銜接**：`pcces_items` 應帶 **`contract_version_id`**（或等價欄位），或採「每版本整表快照」之 `pcces_item_snapshots`，避免單一 `project_id` 無法表達歷史契約。

### 2.2 更新方式（兩種入口並存）

#### 入口 A：系統線上編輯（少量）

- 樹狀 UI 直接修改數量或單價。
- 適合 1～5 筆微調。

#### 入口 B：Excel 批次上傳（大量）

**模板原則**

- 由系統產出，格式自控。
- 含 **`item_key`（鎖定欄）** 作為與資料庫錨定。
- 變更檔**僅需差異列**，不必整份重傳。

**流程**

```
上傳 Excel
  ↓
重複偵測（檔案 hash + 內容指紋）
  → 重複：提示使用者，可繼續或取消
  ↓
進入暫存區（staging）
  ↓
使用者勾選要匯入的列
  → 修改列：依 item_key 自動對應
  → 新增列：使用者指定掛載之父層（或 mainItem 路徑）
  ↓
確認匯入 → 建立新版本 + 變更紀錄
```

**暫存區欄位可編輯性**

| 欄位 | 可編輯 |
|------|--------|
| 說明、單位、數量 | 否（或僅限管理員；需政策） |
| 單價 | 是 |
| 複價（單價 × 數量） | 否，自動計算 |

**暫存區其他規則**

- 設 **`expired_at`**，逾 N 天自動清除。
- 若該工項**已有施工日誌完成量**，匯入時需**警示／阻擋規則**（例如：縮減契約數量低於已完工作量時禁止）。

### 2.3 變更紀錄（概念）

```sql
CREATE TABLE pcces_item_changes (
  id              SERIAL PRIMARY KEY,
  item_id         INT REFERENCES pcces_items(id),
  contract_version_id INT,  -- 建議明確綁定版本
  changed_at      TIMESTAMPTZ DEFAULT NOW(),
  changed_by      INT REFERENCES users(id),
  field           VARCHAR(20),  -- e.g. 'quantity', 'unit_price'
  old_value       NUMERIC,
  new_value       NUMERIC,
  reason          TEXT
);
```

---

## 三、預定進度設定（施工日誌前提一）

### 3.1 設定方式

- 使用者以**兩週為單位**輸入進度節點（milestone）。
- 搭配**開工日**與**竣工日**（或專案總工期）換算成「第 n 週／節點序」與實際日曆對照。

### 3.2 內插公式（參考）

對任意日 `day`（與里程碑同一座標系，例如「自開工起第幾日」或 Julian／序號）：

```javascript
const progress = (day) => {
  const before = milestones.findLast((m) => m.day <= day)
  const after = milestones.find((m) => m.day > day)
  if (!after) return before.progress
  return (
    before.progress +
    ((after.progress - before.progress) * (day - before.day)) /
      (after.day - before.day)
  )
}
```

### 3.3 進度表版本管理

- 停工復工、工期調整 → 產生**新版**預定進度表。
- 版本具 **`approved_at`**：查詢「某日預定進度」時，取 **`approved_at <= 該日` 之最新版本**再內插。

```sql
CREATE TABLE progress_schedules (
  id          SERIAL PRIMARY KEY,
  project_id  INT,
  version     INT,
  approved_at DATE,
  reason      TEXT,
  is_active   BOOLEAN
);

CREATE TABLE progress_milestones (
  id           SERIAL PRIMARY KEY,
  schedule_id  INT REFERENCES progress_schedules(id),
  week_no      INT,
  progress     NUMERIC
);
```

### 3.4 停工

- 停工期間：預定進度為**水平線**（百分比不隨日曆前進而增加）。
- 停工事件觸發**新版**進度表；新版自**核定日後**生效，**不竄改已過去之日**的已生效版本結果。

### 3.5 工期調整

- 竣工日異動：節點之**絕對日曆**跟著位移，**相對完成百分比不變**。
- 節點儲存**相對週次**（或相對序），由開竣工映射到實際日期。

### 3.6 圖表呈現

- **預定線**：版本切換處可呈現「水平＋斜線」組合，反映停工／重排。
- **實際線**：語意上應**單調不減**（僅持平或上升）；若允許修正歷史，需另以標記／審計說明，避免與法遵解讀衝突。

---

## 四、施工日誌

### 4.1 歷史修正：紙本痛點與系統解法

**背景**：紙本時代若修改某日數量，需往後重算累計，成本高。

**作法**：每筆日誌儲存**當日淨量**（或儲存「當日回報累計」由系統換算為當日淨量，擇一為**唯一真相**）；**累計一律由查詢即時聚合**。

```sql
-- 某工項至指定日之累計完成數量
SELECT COALESCE(SUM(daily_quantity), 0)
FROM construction_log_items
WHERE project_id = $1
  AND pcces_item_id = $2
  AND log_date <= $3;
```

修改某日數量後，後續累計自動正確，無需逐日改寫。

> **與 UI 的對齊**：若畫面讓使用者輸入「累計」，後端仍應換算成「當日淨量」入庫，並在 API 契約中寫清楚，避免雙欄並存造成不一致。

### 4.2 修改後驗證

```
修改當日量（或換算後之淨量）
  ↓
自修改日起至「今天」或「該版契約有效區間」重算累計
  ↓
逐日（或逐工項）檢查：累計是否 ≤ 當日有效之契約數量
  ↓
超標 → 擋下，列出衝突日期／工項
通過 → 允許儲存
```

契約版本切換日：該工項當日適用之 `quantity` 應取自 **`approved_at` 有效之版本**。

### 4.3 Audit log

```sql
CREATE TABLE log_item_audits (
  id             SERIAL PRIMARY KEY,
  log_item_id    INT,
  changed_at     TIMESTAMPTZ DEFAULT NOW(),
  changed_by     INT REFERENCES users(id),
  old_quantity   NUMERIC,
  new_quantity   NUMERIC,
  reason         TEXT
);
```

監造可查：何人、何時、何因修改哪筆數量。

### 4.4 不可竄改原則（建議定義狀態機）

| 狀態 | 說明 |
|------|------|
| 草稿 | 可改欄位，可不寫 audit |
| 已提交／已簽核 | 原則唯讀；僅允許「作廢＋重開」或具權限之**更正申請**（寫 audit） |
| 補登 | 允許補填過去日期，但需 **audit**（補登時間、操作者、原因） |

- **預定進度**：系統計算，使用者不可手改。
- **實際進度（%）**：算法待定（§7）；若由日誌與契約推算，應與「不可下修」規則一致。
- **新進度表 `approved_at`**：不宜早於「建立該版本之日」或業務定義之基準日（防呆）。

### 4.5 核心欄位摘要

**施工項目（工項）**

- 清單：PCCES **general** 葉節點（依當日有效契約版本）。
- 輸入：**累計數量**（UI）→ 後端換算 **當日淨量**（建議）。
- 限制：**累計 ≤ 契約數量**（前後端皆驗）。
- 版本切換：於 `approved_at` 當日日誌標示「契約／工項已更新」。

**人機料**

- 由主檔勾選（人力／機具／材料）；填**當日使用量**。
- **快照**：建立日誌當下寫入快照，**不因主檔日後修改而回溯**；主檔更新反映於**隔日起**新日誌（政策可再細化）。

**預定進度**

- 依當日有效進度表版本內插，唯讀。

**實際進度**

- 算法待確認（金額加權、數量加權、或關鍵工項等），見 §7。

**其他法規／表格式欄位**

- 技術士專業工程（有／無）
- 職安衛（選項＋說明）
- 取樣試驗、通知協力廠商、重要事項等（依表單欄位實作）

---

## 五、估驗模組

### 5.1 核心邏輯

```
本次可估驗數量（建議值）= 累計完成數量 − 已請款數量
本次估驗數量            = 人工填寫（可低於建議值，不可超過）
本次估驗金額            = 本次估驗數量 × 單價（依有效契約版本）
本次止累計估驗金額       = 歷史累計金額 + 本次估驗金額
```

### 5.2 估驗表欄位（概念）

| 欄位 | 來源 | 可編輯 |
|------|------|--------|
| (一) 契約數量 | PCCES／契約版本 | 否 |
| 變更後核定數量 | 契約變更版本 | 否 |
| (三) 單價 | PCCES／契約版本 | 否 |
| (四) 本次估驗數量 | 人工 | 是 |
| 本次可估驗數量 | 系統 | 否 |
| (五) 本次止累計估驗數量 | 系統 | 否 |
| (六) 本次估驗金額 | 系統 | 否 |
| (七) 本次止累計估驗金額 | 系統 | 否 |

### 5.3 父層 EV 小計

- 葉節點金額確定後，父層遞迴加總。
- 與 PCCES 複價階層加總邏輯**共用同一套**（避免施工日誌、估驗、報表三套數字）。

### 5.4 歷史估驗回填

- **有歷史**：匯入「截至上線前已請款累計量」作為期初已請款。
- **無歷史**：期初為 0，自第一期起算。
- 不需重建完整歷史單據，除非稽核要求完整影像／PDF 附件（可另議）。

---

## 六、工項進度橫條圖（獨立頁面）

### 6.1 顯示邏輯

每個工項一列，三層語意：

```
工項名稱 |██████░░░░──────────|
          已請款  累計完成    契約數量
```

| 區段 | 意義 | 資料來源 |
|------|------|----------|
| 已請款（深色） | 請款率 | 估驗模組累計 |
| 累計完成（淺色） | 完成率 | 施工日誌累計 |
| 底色總長 | 100% 基準 | 契約數量（有效版本） |

**可讀性**：一眼區分「做了多少」「請了多少」「尚可可請款空間（完成未請）」。

### 6.2 其他功能

- 篩選、匯出、權限（專案 RBAC）— 細節待產品訂版。

---

## 七、待確認與後續事項

| 項目 | 狀態 |
|------|------|
| 實際進度 % 的換算（金額加權、數量加權、WBS 關鍵項等） | 待確認 |
| 工項進度橫條圖：篩選、匯出、排序、大量工項效能 | 待討論 |
| 施工日誌「狀態機」（草稿／已提交／補登／更正）與法遵對齊 | 建議與監造／業主確認 |
| `documentType = budget vs contract` 是否皆匯入、如何顯示 | 待確認 |

---

## 八、設計審閱重點（建議）

以下為閱讀原規格後的**實作向建議**，不變更業務意圖，僅降低前後矛盾與後續重工風險。

1. **契約版本是第一類公民**  
   施工日誌、估驗、進度條圖皆依「某日有效契約」取數量／單價；資料模型應自始帶 `contract_version_id`（或等價），避免 `pcces_items` 只有 `project_id` 時難以重播歷史。

2. **`amount` 與 `quantity * unit_price`**  
   XML 複價常因四捨五入與乘積不完全相等；若 DB 用 GENERATED 強制相等，報表與 PCCES 列印件可能對不起來。建議：**匯入複價**與**計算複價**分欄或擇一為主、另一作核對差異。

3. **施工日誌唯一真相：當日淨量 vs 累計**  
   UI 可輸入累計，但持久化層建議單一欄位語意，並在 API 文件與錯誤訊息中寫死，避免雙寫。

4. **修改歷史日誌與「不可竄改」**  
   技術上可藉由狀態＋audit 滿足「軌跡完整」；需與使用者溝通「唯讀」是指**無痕改**，而非**不可更正**。

5. **Excel staging 與契約版本**  
   暫存列應綁定「將產生的新版本 id」或「基底版本 id」，確認匯入時才正式 fork，避免多人同時編輯衝突。

6. **與本專案既有模組**  
   實作前宜對照 `prisma/schema.prisma`、專案權限模組（`project-module-permissions`）及是否已有 WBS／資源成本設計（`wbs-resource-cost-design.md`），決定施工日誌工項是否與 WBS 節點對應或僅平行於 PCCES。

---

## 文件變更紀錄

| 日期 | 說明 |
|------|------|
| 2026-03-21 | 初版：彙整使用者與 Claude 之討論，補齊目錄、狀態機、版本銜接與審閱建議 |
| 2026-03-21 | 新增連結至 `construction-daily-log-system-inventory.md`（元件盤點） |
