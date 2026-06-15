-- Backdating Slice 3: backfill effectiveDate for legacy rows so reports can filter
-- on it directly. Behavior-neutral — it writes exactly the value consumers already
-- fall back to (createdAt) via resolveEffectiveDate. New rows (Slice 1) and edited
-- rows (Slice 2) already have effectiveDate set, so only legacy NULLs are touched.
UPDATE "Order"    SET "effectiveDate" = "createdAt" WHERE "effectiveDate" IS NULL;
UPDATE "Movement" SET "effectiveDate" = "createdAt" WHERE "effectiveDate" IS NULL;
