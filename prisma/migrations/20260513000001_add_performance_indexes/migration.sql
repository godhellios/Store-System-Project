-- Performance indexes — added 2026-05-13
-- Covers all unindexed FK fields and high-frequency query columns.
-- Applied directly via db execute due to migration history drift.

CREATE INDEX IF NOT EXISTS "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX IF NOT EXISTS "Product_isActive_approvalStatus_idx" ON "Product"("isActive", "approvalStatus");

CREATE INDEX IF NOT EXISTS "Stock_locationId_idx" ON "Stock"("locationId");

CREATE INDEX IF NOT EXISTS "Order_type_createdAt_idx" ON "Order"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_grnStatus_idx" ON "Order"("grnStatus");
CREATE INDEX IF NOT EXISTS "Order_goodsOutStatus_idx" ON "Order"("goodsOutStatus");
CREATE INDEX IF NOT EXISTS "Order_transferStatus_idx" ON "Order"("transferStatus");
CREATE INDEX IF NOT EXISTS "Order_adjustmentStatus_idx" ON "Order"("adjustmentStatus");

CREATE INDEX IF NOT EXISTS "OrderLine_orderId_idx" ON "OrderLine"("orderId");

CREATE INDEX IF NOT EXISTS "Movement_productId_createdAt_idx" ON "Movement"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "Movement_orderId_idx" ON "Movement"("orderId");
CREATE INDEX IF NOT EXISTS "Movement_createdAt_idx" ON "Movement"("createdAt");

CREATE INDEX IF NOT EXISTS "OpnameSession_locationId_status_idx" ON "OpnameSession"("locationId", "status");
CREATE INDEX IF NOT EXISTS "OpnameSession_createdAt_idx" ON "OpnameSession"("createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityId_entityType_idx" ON "AuditLog"("entityId", "entityType");
