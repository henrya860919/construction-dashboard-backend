-- 僅供修復半套 migration：刪除後可再執行 prisma migrate deploy
DROP TABLE IF EXISTS "pcces_items" CASCADE;
DROP TABLE IF EXISTS "pcces_imports" CASCADE;
