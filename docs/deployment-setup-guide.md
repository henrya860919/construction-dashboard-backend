# 全託管正式環境架設教學（Railway、Vercel、Cloudflare R2）

本文件為 **step-by-step** 操作說明，協助在 **prod** 分支上以全託管方式架設正式環境。完成後，後端跑在 Railway、前端跑在 Vercel、檔案存於 Cloudflare R2。

**前置**：程式碼已推送到 GitHub，且存在 **prod** 分支。

---

## 一、Railway（後端 API + PostgreSQL）

### 1.1 註冊與建立專案

1. 前往 [railway.app](https://railway.app)，用 GitHub 登入。
2. 點 **New Project**。
3. 選 **Deploy from GitHub repo**，授權 Railway 存取你的 GitHub，選擇 **construction-dashboard-backend**（後端 repo）。
4. 在 **Branch** 選擇 **prod**（重要：正式版只從 prod 部署）。
5. Railway 會偵測到 Node 專案，根目錄指向 repo 根目錄即可。若有 `nixpacks.toml`，會依其建置（含 `prisma generate` + `npm run build`），無須手動設 Build Command。

### 1.2 新增 PostgreSQL

1. 在專案內點 **+ New** → **Database** → **PostgreSQL**。
2. 等 PostgreSQL 建立完成，點進該服務 → **Variables** 或 **Connect**，可看到 `DATABASE_URL`。
3. 回到 **後端服務**（你的 Node 應用），點 **Variables**，把 PostgreSQL 的 `DATABASE_URL` 加進來：
   - 在 PostgreSQL 服務頁點 **Connect** → **Postgres connection URL**，複製。
   - 在後端服務 **Variables** 新增：`DATABASE_URL` = 貼上該連線字串。

### 1.3 後端環境變數（必填）

在後端服務的 **Variables** 中新增以下變數（值請改為正式用）：

| 變數 | 說明 | 範例／產生方式 |
|------|------|------------------|
| `NODE_ENV` | 固定為 production | `production` |
| `JWT_SECRET` | JWT 簽章用，強隨機 | 終端機執行：`openssl rand -base64 32` |
| `JWT_REFRESH_SECRET` | Refresh token 用，另一組強隨機 | 同上再執行一次 |
| `CORS_ORIGIN` | 正式前端網址（等 Vercel 部署後再填） | `https://你的專案.vercel.app` 或自訂網域 |
| `ENCRYPTION_KEY` | 設備 RTSP 加密（攝影機功能） | `openssl rand -hex 16` 或 `openssl rand -base64 32` |
| `MEDIAMTX_API_URL` | 若暫無 mediamtx 可先留空或註解 | `http://127.0.0.1:9997`（有 mediamtx 時再設） |
| `MEDIAMTX_PUBLIC_HOST` | 若暫無 mediamtx 可先留空 | 有串流時再設，例如 `https://stream.你的網域.com` |

**檔案儲存**（二擇一）：

- 先用本機儲存（測試）：`FILE_STORAGE_TYPE=local`，並設 `FILE_STORAGE_LOCAL_PATH=./storage`（Railway 重啟會清空，僅適合測試）。
- 正式建議用 R2：完成下方「三、Cloudflare R2」後，設 `FILE_STORAGE_TYPE=r2` 及所有 `R2_*` 變數。

### 1.4 CORS_ORIGIN 要填哪些網址？

後端用 `CORS_ORIGIN` 決定「允許哪些前端網址」打 API。**只填你「會用來開正式前端的網址」**即可。

| 網址類型 | 要不要填進 CORS_ORIGIN？ | 說明 |
|----------|--------------------------|------|
| **正式／主要網址**（例如 `construction-dashboard-frontend-ust.vercel.app`） | ✅ **要** | 使用者或你平常開的網址，一定要填。 |
| **Vercel 預設 Production 網址**（專案名.vercel.app） | ✅ **要** | 若這是你的正式入口，就填。 |
| **Preview 網址**（含 `-git-xxx-`、`-xxx-1234.vercel.app` 等） | ❌ 一般不填 | 每次 PR／分支都會變，不適合一個個加；預覽請用本機或只連測試後端。 |

**填法**：在 Railway 後端 Variables 的 `CORS_ORIGIN` 填**一個**正式前端網址，例如：

```text
https://construction-dashboard-frontend-ust.vercel.app
```

若有**兩個固定**網址（例如正式 + 一個固定預覽），用**逗號**分隔，不要加空白：

```text
https://construction-dashboard-frontend-ust.vercel.app,https://另一個.vercel.app
```

**記得加 `https://`**，且**不要**在結尾加 `/`。

### 1.5 部署與 Migration

1. 儲存 Variables 後，Railway 會自動重新部署。
2. 部署完成後，到後端服務 **Settings** 或 **Deployments**，可開啟 **Shell**（或用 Railway CLI）執行：
   ```bash
   npx prisma migrate deploy
   ```
   若 Railway 專案有提供 one-off run，也可用 **Run Command** 執行上述指令。
3. 執行成功後，後端 API 即就緒。在 **Settings** → **Networking** 可產生 **Public URL**（例如 `https://xxx.railway.app`），此即後端 API 根網址，稍後給 Vercel 的 `VITE_API_URL` 使用。

#### 1.5.1 Prisma：`P3009` 失敗 migration、或 PCCES 匯入報「column does not exist」

若程式已更新（含 `pcces_imports.approved_at` 等欄位）但資料庫尚未套用對應 migration，匯入 PCCES 時可能出現 **`Invalid ... pccesImport.create()`**、或 **`The column (not available) does not exist`**。另若曾有一次 migration 執行中斷，`_prisma_migrations` 會留下 **失敗紀錄**，導致 **`P3009`**，後續 `migrate deploy` 拒絕繼續。

請在本機或 Railway Shell（已設好 `DATABASE_URL`）依序處理：

1. 查看狀態：`npx prisma migrate status`
2. 若出現 **failed** 的 `20260323120000_construction_daily_logs`：
   - 用任意 SQL 客戶端查詢是否已有資料表 **`construction_daily_logs`**（`public` schema）。
   - **表已存在**（代表該次 migration 實際已套用、只是紀錄卡住）：  
     `npx prisma migrate resolve --applied "20260323120000_construction_daily_logs"`
   - **表不存在**（代表該次 migration 未成功）：  
     `npx prisma migrate resolve --rolled-back "20260323120000_construction_daily_logs"`
3. 套用其餘待執行 migration：  
   `npx prisma migrate deploy`
4. 再執行：`npx prisma generate`（若 CI 未自動跑）

完成後 **`pcces_imports`** 應具備 **`approved_at`、`approved_by_id`**，**`construction_daily_log_work_items`** 應具備 **`pcces_item_id`**（若該 migration 一併尚未套用）。較新之 **`20260326120000_construction_daily_log_work_item_unit_price`** 會新增可選 **`unit_price`**（單價快照）。

**`version_label`（PCCES 版本名稱）**：若終端機出現 **`pccesImport.findMany`／`create` … `version_label` does not exist**（**`P2022`**），代表 **`20260322161000_pcces_import_version_label`** 尚未套用到目前這顆 DB。先排除 **`P3009`**（見上），再執行 `npx prisma migrate deploy`。

**（開發用）migration 調整**：`version_label` 已自錯序的 `20260321120000_*` **改為** `20260322161000_pcces_import_version_label`（須在 `pcces_imports` 建表之後）。**全新 reset／新環境**直接依現有 migrations 即可。若某台 DB 的 `_prisma_migrations` **曾成功記錄舊檔名**且已具 `version_label` 欄位，部署時可能重複 `ADD COLUMN` 失敗，需手動對齊 migration 紀錄或改走新庫。

**曾卡住的 `20260325100000_construction_valuations`／`20260325110000_pcces_item_changes`**：舊版 migration 曾誤用 FK 目標表名 **`users`／`projects`**（本專案實際為 **`"User"`、`"Project"`**），可能導致 migration 中途失敗、表已建立但無 FK，且阻擋後續 migration。repo 內 SQL 已修正；若本機 DB 已卡在該狀態，可參考 **`scripts/fix-stuck-valuations-migration.ts`**（補 FK 與權限 backfill）後再 `npx prisma migrate resolve --applied …` 與 `migrate deploy`（請先閱讀腳本註解）。

#### 1.5.2 Prisma：`P2021`／`construction_valuation_lines` does not exist（估驗計價）

若後端已更新、已執行 `prisma generate`，但 **尚未對目前 `DATABASE_URL` 指向的資料庫套用** migration **`20260325100000_construction_valuations`**，呼叫估驗相關 API 時會出現 **`The table public.construction_valuation_lines does not exist`**（Prisma **`P2021`**）。

請在**與後端相同的 `DATABASE_URL`** 環境下執行：

```bash
npx prisma migrate status   # 應會列出未套用的 20260325100000_construction_valuations
npx prisma migrate deploy
```

本機開發可改用：`npm run db:migrate:dev`（會套用並同步 schema）。

套用成功後應存在表 **`construction_valuations`**、**`construction_valuation_lines`**（以及該 migration 內對租戶／專案權限的 backfill）。完成後**重啟後端**。

### 1.6 小結

- 後端服務從 **prod** 分支部署，根目錄有 `nixpacks.toml` 時會自動執行 `prisma generate` 與 `npm run build`。
- 務必設定 `DATABASE_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`CORS_ORIGIN`、`ENCRYPTION_KEY`（生產環境必設）。
- 記下後端的 **Public URL**，下一節 Vercel 會用到。

---

## 二、Vercel（前端 SPA）

### 2.1 建立專案

1. 前往 [vercel.com](https://vercel.com)，用 GitHub 登入。
2. 點 **Add New** → **Project**，選擇 **construction-dashboard-frontend**（前端 repo）。
3. **Branch** 選 **prod**。
4. **Framework Preset** 選 **Vite**（通常會自動偵測）。
5. **Root Directory** 維持預設（repo 根目錄）。

### 2.2 環境變數

在 **Environment Variables** 新增：

| 名稱 | 值 | 說明 |
|------|-----|------|
| `VITE_API_URL` | 後端 API 根網址 | 即 Railway 後端的 Public URL，例如 `https://xxx.railway.app`（勿加尾端斜線） |

可勾選 **Production**（以及 Preview 若希望預覽環境也連正式 API）。

### 2.3 部署

1. 點 **Deploy**，Vercel 會建置並部署。
2. 完成後會得到一個網址，例如 `https://construction-dashboard-frontend-xxx.vercel.app`。
3. 回到 **Railway 後端**，把 **CORS_ORIGIN** 設為該 Vercel 網址（或自訂網域），例如：
   ```
   https://construction-dashboard-frontend-xxx.vercel.app
   ```
   若有多個來源，用逗號分隔。儲存後 Railway 會重新部署。

### 2.4 小結

- 前端從 **prod** 分支部署，建置時會帶入 `VITE_API_URL`。
- 前後端都就緒後，用瀏覽器開 Vercel 網址即可登入與操作（需後端已有使用者與租戶資料）。

---

## 三、Cloudflare R2（檔案儲存）

### 3.1 建立 R2 儲存桶

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com)，左側選 **R2 Object Storage**。
2. 點 **Create bucket**，名稱自訂（例如 `construction-dashboard-prod`），**Location** 選 **Automatic** 即可。
3. 建立完成後，進入該 bucket。

### 3.2 取得 API 金鑰（R2 存取用）

1. 在 R2 頁面左側或上方找到 **Manage R2 API Tokens**（或 **Overview** → **R2 API Tokens**）。
2. 點 **Create API token**：
   - **Token name**：例如 `construction-dashboard-backend`。
   - **Permissions**：選 **Object Read & Write**。
   - **Specify bucket**：可限定剛建立的 bucket，或先選 **All buckets**（依安全需求）。
3. 建立後會顯示 **Access Key ID** 與 **Secret Access Key**，**只顯示一次**，請複製保存。

### 3.3 取得 Endpoint 與 Public URL（選填）

- **Endpoint**：在 bucket 的 **Settings** 或 R2 總覽可看到，格式類似：
  ```
  https://<account_id>.r2.cloudflarestorage.com
  ```
  或依 Cloudflare 文件顯示為準。
- **Public URL**（若需直接對外連結檔案）：可為 bucket 綁定 **Custom Domain** 或使用 R2 的 public bucket 網址（依 Cloudflare 當時功能）。若後端只做「上傳／下載由 API 轉發」，可不設 `R2_PUBLIC_URL`。

### 3.4 在 Railway 後端設定 R2 變數

回到 **Railway** → 後端服務 → **Variables**，新增：

| 變數 | 值 |
|------|-----|
| `FILE_STORAGE_TYPE` | `r2` |
| `R2_ACCESS_KEY_ID` | 上述 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 上述 Secret Access Key |
| `R2_BUCKET_NAME` | bucket 名稱（例如 `construction-dashboard-prod`） |
| `R2_ENDPOINT` | 上述 Endpoint URL |
| `R2_PUBLIC_URL` | 若有用自訂網域或 public 網址則填，否則可先留空 |

儲存後 Railway 會重新部署，之後檔案上傳會存到 R2。

---

## 四、流程總覽與建議順序

1. **Railway**：建立專案、連 prod 分支、加 PostgreSQL、設後端環境變數（不含 R2）、部署 → 執行 `prisma migrate deploy` → 記下 Public URL。
2. **Vercel**：建立專案、連 prod 分支、設 `VITE_API_URL` 為 Railway 的 Public URL → 部署 → 記下前端網址。
3. **Railway**：把 `CORS_ORIGIN` 設成 Vercel 前端網址，重新部署。
4. **Cloudflare R2**：建立 bucket、建立 API token、在 Railway 後端加上 R2 相關變數與 `FILE_STORAGE_TYPE=r2`。
5. **驗收**：用瀏覽器開前端網址，登入、建立專案、測試檔案上傳（若有）與主要功能。

---

## 五、在 Railway 架設 mediamtx（攝影機串流）

若正式環境要啟用攝影機即時串流，可在 **同一個 Railway 專案** 裡新增一個 **mediamtx 服務**，與 Backend 並存，透過內網互相連線。

### 5.1 架構說明

- **Backend 服務**：照現有方式部署（Node + Express），對外只暴露 API（例如 `https://xxx.railway.app`）。
- **mediamtx 服務**：跑官方 Docker 映像 `bluenviron/mediamtx`，對外只暴露 **8889**（WebRTC 播放）；**9997**（API）與 **8554**（RTSP 推流）僅供 Backend 與現場 go2rtc 透過 Railway 內網／公網連線。推流改為 RTSP 可避免雲端 RTMP AVCC 解析錯誤。
- Backend 用 **內網網址** 呼叫 mediamtx API（`MEDIAMTX_API_URL`），前端與現場安裝包用 **mediamtx 的對外網址** 播放／推流（`MEDIAMTX_PUBLIC_HOST`）。

### 5.2 在專案中新增 mediamtx 服務

請先確認 **prod 分支** 已包含 `docker/mediamtx/Dockerfile`（若剛新增，請 `git add`、`git commit`、`git push origin prod`）。

1. **同一個 Railway 專案** 內，點 **+ New** → **GitHub Repo**。
2. 選 **同一個 repo**（construction-dashboard-backend），**Branch** 選 **prod**。
3. 在 **Settings**（或建立時的進階選項）中設定 **Root Directory** 為 **`docker/mediamtx`**。如此 Railway 會以該目錄為根目錄建置，並使用目錄內的 `Dockerfile`（`FROM bluenviron/mediamtx`）。
4. **Build Command**、**Start Command** 留空即可（由 Docker 映像內建）。
5. 儲存後觸發一次 **Deploy**，確認 mediamtx 服務建置並啟動成功。

### 5.3 設定 mediamtx 服務的 Port

Railway 預設會偵測容器開的 port；若沒有，需手動指定「對外要暴露的 port」：

1. 點進 **mediamtx 服務** → **Settings** → **Networking**（或 **Deploy** 區塊的 Port 設定）。
2. 將 **Public Networking** 的 **Port** 設為 **8889**（mediamtx 的 WebRTC 預設埠）。
3. 部署完成後，Railway 會給此服務一個對外網址，例如 `https://mediamtx-xxx.up.railway.app`（實際以 Railway 顯示為準）。

### 5.4 取得內網網址（給 Backend 用）

1. 在 mediamtx 服務的 **Settings** → **Networking**（或 **Variables**）可看到 **Private Network** 的 hostname，格式通常為 **`<服務名稱>.railway.internal`**（服務名稱可在 Settings 頂部看到，例如 `mediamtx`）。
2. Backend 要連的是 **API**（port **9997**），所以內網完整 URL 為：
   ```text
   http://<mediamtx 服務名稱>.railway.internal:9997
   ```
   例如：`http://mediamtx.railway.internal:9997`（若服務名稱為 `mediamtx`）。

### 5.5 後端（Backend）環境變數

在 **Backend 服務** 的 **Variables** 中新增或修改：

| 變數 | 值 | 說明 |
|------|-----|------|
| `MEDIAMTX_API_URL` | `http://<mediamtx 服務名稱>.railway.internal:9997` | Backend 呼叫 mediamtx API 的內網網址（見 5.4）。 |
| `MEDIAMTX_PUBLIC_HOST` | `https://mediamtx-xxx.up.railway.app` | mediamtx 的 **對外** URL，供**前端 WebRTC 播放**用（見 5.3）。 |
| `MEDIAMTX_RTMP_PUBLIC_URL` | `rtmp://xxx.proxy.rlwy.net:1935`（依你畫面上的 TCP Proxy 為準） | **選填**。Railway 加 TCP Proxy（port **1935**）後會給一組專用網址，填在這裡（含 `rtmp://` 與 port），安裝包內的 go2rtc 推流 URL 才會正確；go2rtc publish 僅支援 RTMP/RTMPS。 |

存檔後 Backend 會重新部署；若沒有，可手動 **Redeploy** 一次。

### 5.6 RTMP（現場 go2rtc 推流）說明

- **WebRTC（8889）**：已透過 mediamtx 的 Public URL 對外開放，前端與瀏覽器可正常播放。
- **RTMP（1935）**：現場 go2rtc 以 **RTMP** 推流至 mediamtx（go2rtc publish 不支援外網 RTSP）。AVCC 解析錯誤請用 **ffmpeg:** source 解決。Railway 需對外開 **1935**。
  - **做法一（建議）**：在 mediamtx 服務的 **Settings → Networking** 加 **+ TCP Proxy**，對外 port 選 **1935**、對應容器 **1935**。Railway 會給一組專用位址（如 `xxx.proxy.rlwy.net:12345`）。在 Backend 的 **Variables** 新增 **`MEDIAMTX_RTMP_PUBLIC_URL`** = `rtmp://xxx.proxy.rlwy.net:12345`（含 `rtmp://` 與實際 port）。之後重新下載的安裝包內 go2rtc 推流 URL 會變成 `rtmp://xxx.proxy.rlwy.net:12345/<token>`。
  - **做法二**：若暫時不需現場推流，可先不開 1935，僅用 WebRTC 播放；待有需要時再改用 VPS 獨立部署 mediamtx（見 **production-release-checklist.md**）。

### 5.7 驗收

1. 在 Dashboard 建立一臺攝影機（會呼叫 mediamtx API 新增 path）。
2. 若回傳 **503** 且訊息為「串流服務無法連線…」，表示 Backend 連不到 mediamtx，請檢查：
   - mediamtx 服務是否已成功部署、
   - `MEDIAMTX_API_URL` 是否為內網 `http://<服務名>.railway.internal:9997`。
3. 前端到專案內「監測 → 設備／影像」取得播放連結，應可連到 `MEDIAMTX_PUBLIC_HOST` 的 WebRTC 端點。

詳細架構與檢查清單見 **production-release-checklist.md**、**production-environment-planning.md**。

---

## 六、以後怎麼部署（日常發布流程）

之後要上線新功能或修復時，依下列流程操作即可。

### 6.1 開發與合併

1. 在 **main**（或 feature branch）開發、測試。
2. 確認沒問題後，**merge 到 prod 分支**（例如：`git checkout prod && git merge main && git push origin prod`）。

### 6.2 後端（Railway）

- **程式碼**：push 到 **prod** 後，Railway 會自動偵測並重新 **build + deploy**，無須手動觸發。
- **資料庫 schema 變更**（有改 Prisma、有新增 migration 時）：
  1. 在本機後端專案目錄，用 Railway **對外** DATABASE_URL 跑一次 migration：
     ```bash
     cd construction-dashboard-backend
     DATABASE_URL="你的Railway對外連線字串" npx prisma migrate deploy
     ```
  2. 或使用 Railway CLI：先 `railway link` 選對專案與環境，再 `railway run npx prisma migrate deploy`（若 DB 用內部網址，需在 Railway 遠端跑；本機跑請用對外 URL）。
- **Seed**：只有要重灌種子資料時才跑，同上，用對外 DATABASE_URL 或 `railway run npm run db:seed`（需在專案目錄下）。

### 6.3 前端（Vercel）

- **程式碼**：push 到 **prod** 後，Vercel 會自動 **build + deploy**。
- **環境變數**：若曾改 `VITE_API_URL` 等，在 Vercel 專案 **Settings → Environment Variables** 改完後，需 **重新 Deploy** 才會生效（建置時才會帶入）。

### 6.4 流程總覽（一圖流）

```
本機開發 (main) → 合併到 prod → git push origin prod
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
            Railway 自動 build + deploy              Vercel 自動 build + deploy
            （有 migration 時需手動跑 migrate deploy）
```

### 6.5 檢查清單（每次要上線前）

- [ ] 已 merge 到 **prod** 並 push。
- [ ] 若有改 Prisma schema，已產生 migration 並在正式 DB 跑過 `prisma migrate deploy`。
- [ ] 後端／前端環境變數無誤（Railway Variables、Vercel Environment Variables）。
- [ ] 部署完成後到正式前端網址驗收（登入、主要功能點一輪）。

---

## 七、相關文件

- **production-environment-planning.md**：正式環境整體規劃、費用、環境變數總表。
- **production-release-checklist.md**：發布前檢查、攝影機功能與 mediamtx 部署細節。
- 後端 **.env.example**：所有環境變數說明與範例。
