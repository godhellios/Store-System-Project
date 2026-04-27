-- CreateTable
CREATE TABLE "ProductUnitConversion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conversionFactor" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "ProductUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ProductUnitConversion_productId_name_key" ON "ProductUnitConversion"("productId", "name");

-- AddForeignKey
ALTER TABLE "ProductUnitConversion" ADD CONSTRAINT "ProductUnitConversion_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
