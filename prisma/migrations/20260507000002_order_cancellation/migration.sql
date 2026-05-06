-- Add cancellation fields to Order
ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "cancelledByName" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancelReason" TEXT;
