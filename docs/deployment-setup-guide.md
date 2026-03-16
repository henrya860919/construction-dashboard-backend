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

### 1.4 部署與 Migration

1. 儲存 Variables 後，Railway 會自動重新部署。
2. 部署完成後，到後端服務 **Settings** 或 **Deployments**，可開啟 **Shell**（或用 Railway CLI）執行：
   ```bash
   npx prisma migrate deploy
   ```
   若 Railway 專案有提供 one-off run，也可用 **Run Command** 執行上述指令。
3. 執行成功後，後端 API 即就緒。在 **Settings** → **Networking** 可產生 **Public URL**（例如 `https://xxx.railway.app`），此即後端 API 根網址，稍後給 Vercel 的 `VITE_API_URL` 使用。

### 1.5 小結

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

## 五、後續：攝影機串流（mediamtx）

若正式環境要啟用攝影機即時串流，需另外部署 **mediamtx**（可與 Backend 同機或獨立主機），並在 Railway 後端設定：

- `MEDIAMTX_API_URL`：Backend 能連到的 mediamtx API（例如同機 `http://127.0.0.1:9997` 或他機內網位址）。
- `MEDIAMTX_PUBLIC_HOST`：對外 WebRTC/RTMP 的 https 網址（供前端與現場 go2rtc 連線）。

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
