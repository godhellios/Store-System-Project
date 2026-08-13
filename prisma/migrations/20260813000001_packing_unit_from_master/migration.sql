-- Packing units become a reference to the Unit master instead of a typed copy.
--
-- Before: ProductUnitConversion stored (name, conversionFactor) as free text +
-- a hand-typed number, so a unit could be misspelled and renaming a unit in
-- Settings could not reach the products using it.
-- After:  it stores unitId. Name and factor are read from Unit, so there is one
-- copy of each and a rename propagates for free.
--
-- The legacy columns are kept (nullable, unread) for one release as a safety
-- net; a later migration drops them.
--
-- Written to be safely re-runnable: every step is guarded.

-- 1. Add the link column, nullable for now.
ALTER TABLE "ProductUnitConversion" ADD COLUMN IF NOT EXISTS "unitId" TEXT;

-- 2. Backfill by name, ignoring case and ALL whitespace. This is what maps the
--    377 rows typed as "Sack Of Zipper10" onto the master's "Sack Of Zipper 10"
--    (and the same for 20) without hardcoding those two strings.
UPDATE "ProductUnitConversion" c
SET "unitId" = u.id
FROM "Unit" u
WHERE c."unitId" IS NULL
  AND c."name" IS NOT NULL
  AND lower(replace(u."name", ' ', '')) = lower(replace(c."name", ' ', ''));

-- 3. Refuse to continue if anything failed to map. Better to fail the deploy
--    loudly than to silently drop a product's packaging unit.
DO $$
DECLARE unmapped INT;
BEGIN
  SELECT count(*) INTO unmapped FROM "ProductUnitConversion" WHERE "unitId" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'Cannot migrate: % ProductUnitConversion row(s) match no Unit by name. Create the missing units first.', unmapped;
  END IF;
END $$;

-- 4. Old uniqueness was per (product, typed name); it is now per (product, unit).
ALTER TABLE "ProductUnitConversion" DROP CONSTRAINT IF EXISTS "ProductUnitConversion_productId_name_key";
DROP INDEX IF EXISTS "ProductUnitConversion_productId_name_key";

-- 5. Legacy columns become optional — new rows no longer populate them.
ALTER TABLE "ProductUnitConversion" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "ProductUnitConversion" ALTER COLUMN "conversionFactor" DROP NOT NULL;

-- 6. Lock in the link.
ALTER TABLE "ProductUnitConversion" ALTER COLUMN "unitId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductUnitConversion_unitId_fkey'
  ) THEN
    ALTER TABLE "ProductUnitConversion"
      ADD CONSTRAINT "ProductUnitConversion_unitId_fkey"
      FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnitConversion_productId_unitId_key"
  ON "ProductUnitConversion"("productId", "unitId");

CREATE INDEX IF NOT EXISTS "ProductUnitConversion_unitId_idx"
  ON "ProductUnitConversion"("unitId");
