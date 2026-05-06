-- Add code field to Category (nullable, unique)
ALTER TABLE "Category" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- Add suffix field to Unit (nullable)
ALTER TABLE "Unit" ADD COLUMN "suffix" TEXT;

-- Add approval fields to Product
ALTER TABLE "Product" ADD COLUMN "approvalStatus" TEXT;
ALTER TABLE "Product" ADD COLUMN "pendingChanges" JSONB;
ALTER TABLE "Product" ADD COLUMN "pendingChangedBy" TEXT;
ALTER TABLE "Product" ADD COLUMN "pendingChangedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "reviewedByName" TEXT;
ALTER TABLE "Product" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "reviewNote" TEXT;
