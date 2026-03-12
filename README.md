# Construction Dashboard - Backend

Node.js + Express + TypeScript + Zod + JWT + PostgreSQL + Cloudflare R2。

## 環境

1. 複製 `.env.example` 為 `.env`
2. 填寫 `DATABASE_URL`、`JWT_SECRET`、`CORS_ORIGIN` 等（見 `.env.example`）
3. R2 與 PostgreSQL 上線前再設定即可

## 指令

- `npm run dev` - 開發（tsx watch，port 3003）
- `npm run build` - 編譯 TypeScript
- `npm start` - 執行編譯後的 `dist/index.js`
- `npm run db:studio` 或 `npm run prisma:studio` - 在瀏覽器開啟 Prisma Studio（請在後端專案目錄執行；若用新版 Prisma Studio 桌面 app 出現 introspection 錯誤，改由此指令從終端機啟動即可）
- `npm run db:seed` - 建立測試資料（含測試帳號）
- `npm run db:reset` - 重設 DB 並重新 seed（開發用）

## 若無法登入

1. **後端** `.env` 需有 `JWT_SECRET`（無則啟動時會拋錯）
2. **前端** `.env` 需有 `VITE_API_URL=http://localhost:3003`（或你的後端網址）
3. 先執行 `npm run db:seed` 建立測試帳號；測試帳號密碼皆為 `password123`（見 seed 或登入頁說明）
4. 確認後端已啟動（`npm run dev`）且 DB 可連（`DATABASE_URL` 正確）
5. 若回傳 500 且 `code: "INTERNAL_ERROR"`：開發環境下 API 回應的 `error.details` 會帶實際錯誤原因；或查看後端終端機的 `POST /auth/login` 錯誤日誌

## API

- `GET /health` - 健康檢查
- `GET /api/v1` - API 根
