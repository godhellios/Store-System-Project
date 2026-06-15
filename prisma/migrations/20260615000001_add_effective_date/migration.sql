-- Backdating feature, Slice 1: additive "effective date" (business date) foundation.
-- Nullable columns, populated only on new rows from here on. No backfill: legacy rows
-- stay NULL and consumers treat NULL as createdAt (see src/lib/effective-date.ts).
ALTER TABLE "Order" ADD COLUMN "effectiveDate" TIMESTAMP(3);
ALTER TABLE "Movement" ADD COLUMN "effectiveDate" TIMESTAMP(3);

-- Supports later point-in-time / per-product chronological queries (reports, cost replay).
CREATE INDEX "Movement_productId_effectiveDate_idx" ON "Movement"("productId", "effectiveDate");
