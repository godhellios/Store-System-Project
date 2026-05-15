-- Convert approvalStatus from nullable text to a proper PostgreSQL enum

-- Step 1: create the enum type
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REJECTED');

-- Step 2: migrate null → ACTIVE (legacy products pre-dating the approval workflow)
UPDATE "Product" SET "approvalStatus" = 'ACTIVE' WHERE "approvalStatus" IS NULL;

-- Step 3: cast column from text to enum
ALTER TABLE "Product"
  ALTER COLUMN "approvalStatus" TYPE "ApprovalStatus"
  USING "approvalStatus"::"ApprovalStatus";

-- Step 4: make non-nullable with default
ALTER TABLE "Product"
  ALTER COLUMN "approvalStatus" SET NOT NULL,
  ALTER COLUMN "approvalStatus" SET DEFAULT 'ACTIVE';
