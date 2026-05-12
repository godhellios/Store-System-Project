-- Add goodsOutStatus and transferStatus to Order for approval workflow
ALTER TABLE "Order" ADD COLUMN "goodsOutStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "transferStatus" TEXT;
