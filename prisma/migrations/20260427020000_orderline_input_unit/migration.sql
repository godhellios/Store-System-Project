-- Add input unit tracking to OrderLine
-- These are nullable so existing rows are unaffected
ALTER TABLE "OrderLine" ADD COLUMN "inputQty"  DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN "inputUnit" TEXT;
