-- CreateTable: Supplier
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Supplier.name unique
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- AlterTable: Order add supplierId
ALTER TABLE "Order" ADD COLUMN "supplierId" TEXT;

-- AlterTable: OrderLine add unitCost
ALTER TABLE "OrderLine" ADD COLUMN "unitCost" DECIMAL(65,30);

-- AlterTable: Product add lastCost and avgCost
ALTER TABLE "Product" ADD COLUMN "lastCost" DECIMAL(65,30);
ALTER TABLE "Product" ADD COLUMN "avgCost" DECIMAL(65,30);

-- AddForeignKey: Order.supplierId -> Supplier.id
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
