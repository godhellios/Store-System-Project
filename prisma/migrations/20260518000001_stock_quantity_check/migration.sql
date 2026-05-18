-- Prevent stock quantity from going negative at the DB level.
-- Application code already guards this, but the constraint is a last-resort safety net.
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_quantity_check" CHECK (quantity >= 0);
