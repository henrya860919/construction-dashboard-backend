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

之後會加上 JWT 認證與權限（系統層／專案層），專案列表與人員列表將依登入者過濾。

---

## 四、功能之後慢慢加

- 認證（登入／JWT）與「當前使用者」脈絡。
- 專案列表 API 依「當前使用者可存取的專案」過濾（ProjectMember + 系統層）。
- 專案成員（ProjectMember）的 CRUD、邀請／移除。
- 單租後台、多租後台所需之額外 API。

以上依 `docs/multi-project-multi-tenant-planning.md` 與 `.cursor/rules` 對齊。
