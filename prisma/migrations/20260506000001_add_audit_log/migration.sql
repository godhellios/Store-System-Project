-- CreateTable
CREATE TABLE "AuditLog" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT,
    "userName"    TEXT NOT NULL,
    "userRole"    TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entityId"    TEXT,
    "entityType"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
