-- AlterTable: add adjustment approval fields to Order
ALTER TABLE "Order" ADD COLUMN "adjustmentStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "adjustmentReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "reviewedByName"   TEXT;
ALTER TABLE "Order" ADD COLUMN "reviewedAt"       TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "reviewNote"       TEXT;
