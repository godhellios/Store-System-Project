-- AlterTable: add parent unit and conversion factor to Unit
ALTER TABLE "Unit" ADD COLUMN "parentUnitId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "conversionFactor" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_parentUnitId_fkey"
  FOREIGN KEY ("parentUnitId") REFERENCES "Unit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
