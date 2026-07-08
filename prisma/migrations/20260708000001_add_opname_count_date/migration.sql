-- Business date of the physical count (nullable; null = counted when created).
ALTER TABLE "OpnameSession" ADD COLUMN "countDate" TIMESTAMP(3);
