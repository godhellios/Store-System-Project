-- Opname by category: scope a physical-count session to one or more categories.
-- Additive only — a new implicit m2m join table between Category and OpnameSession.
-- No changes to existing tables. Empty scope (no rows) = whole-warehouse count.

-- CreateTable
CREATE TABLE "_CategoryToOpnameSession" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_CategoryToOpnameSession_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CategoryToOpnameSession_B_index" ON "_CategoryToOpnameSession"("B");

-- AddForeignKey
ALTER TABLE "_CategoryToOpnameSession" ADD CONSTRAINT "_CategoryToOpnameSession_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToOpnameSession" ADD CONSTRAINT "_CategoryToOpnameSession_B_fkey" FOREIGN KEY ("B") REFERENCES "OpnameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
