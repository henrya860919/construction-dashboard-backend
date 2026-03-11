# Construction Dashboard - Backend

Node.js + Express + TypeScript + Zod + JWT + PostgreSQL + Cloudflare R2。

## 環境

1. 複製 `.env.example` 為 `.env`
2. 填寫 `DATABASE_URL`、`JWT_SECRET`、`CORS_ORIGIN` 等（見 `.env.example`）
3. R2 與 PostgreSQL 上線前再設定即可

## 指令

- `npm run dev` - 開發（tsx watch，port 3002）
- `npm run build` - 編譯 TypeScript
- `npm start` - 執行編譯後的 `dist/index.js`

## API

- `GET /health` - 健康檢查
- `GET /api/v1` - API 根
