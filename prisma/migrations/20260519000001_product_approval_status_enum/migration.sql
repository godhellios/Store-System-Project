-- Self-healing migration. The original was `ALTER TYPE "ApprovalStatus" RENAME TO "ProductApprovalStatus";`
-- which only works if an "ApprovalStatus" enum already exists. On production it does (it was
-- created out-of-band via `db push`), but that creation step was never captured as a migration,
-- so a clean replay (staging / restore / new dev DB) had nothing to rename and failed (42704).
-- This version handles every case so the chain replays cleanly everywhere.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalStatus') THEN
    -- Legacy DB where the enum exists but hasn't been renamed yet.
    ALTER TYPE "ApprovalStatus" RENAME TO "ProductApprovalStatus";
  ELSIF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductApprovalStatus') THEN
    -- Clean replay: the enum was never created. Create it and convert the TEXT column.
    CREATE TYPE "ProductApprovalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REJECTED');
    ALTER TABLE "Product"
      ALTER COLUMN "approvalStatus" TYPE "ProductApprovalStatus"
      USING ("approvalStatus"::"ProductApprovalStatus");
  END IF;
  -- Else: "ProductApprovalStatus" already exists (already-migrated DB, e.g. production) → no-op.
END
$$;
