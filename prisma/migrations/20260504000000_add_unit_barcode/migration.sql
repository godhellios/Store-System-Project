-- AlterTable
ALTER TABLE "ProductUnitConversion" ADD COLUMN "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnitConversion_barcode_key" ON "ProductUnitConversion"("barcode");
