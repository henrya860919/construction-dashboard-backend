-- PCCES 工項：備註、百分比（對應 XML Remark / Percent）
ALTER TABLE "pcces_items" ADD COLUMN "remark" TEXT NOT NULL DEFAULT '';
ALTER TABLE "pcces_items" ADD COLUMN "percent" DECIMAL(18,4);
