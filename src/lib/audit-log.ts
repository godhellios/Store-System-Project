import { prisma } from "@/lib/prisma";

type AuditParams = {
  session: { user: { id?: string; name?: string | null; role: string } };
  action: string;
  description: string;
  entityId?: string;
  entityType?: string;
};

export async function writeAuditLog({ session, action, description, entityId, entityType }: AuditParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: (session.user as any).id ?? null,
        userName: session.user.name ?? "Unknown",
        userRole: session.user.role,
        action,
        description,
        entityId: entityId ?? null,
        entityType: entityType ?? null,
      },
    });
  } catch {
    // Audit log failure must never block the main operation
  }
}
