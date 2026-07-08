import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isDateAllowed, resolveEffectiveDate } from "@/lib/effective-date";

const JAKARTA_TZ = "Asia/Jakarta"; // for display only
const fmt = (d: Date) =>
  d.toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: JAKARTA_TZ });

// PATCH /api/orders/[id]/effective-date
// Body: { effectiveDate: "YYYY-MM-DD", reason: string }
// Admin-only. Sets the order's business date (stored at 12:00 Asia/Jakarta to
// avoid timezone off-by-one) and syncs every child movement to the same date.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const dateStr: unknown = body?.effectiveDate;
  const reason: unknown = body?.reason;

  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
    return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
  if (typeof reason !== "string" || !reason.trim())
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  // Noon Asia/Jakarta (UTC+7) → the calendar day is preserved in every timezone.
  const proposed = new Date(`${dateStr}T12:00:00+07:00`);
  if (Number.isNaN(proposed.getTime()))
    return NextResponse.json({ error: "A valid date is required" }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.cancelledAt) return NextResponse.json({ error: "Cancelled orders cannot be re-dated" }, { status: 409 });

  // Opname-freeze floor: the latest APPROVED opname across the order's location(s).
  // A backdated count freezes from its business countDate (fall back to approvedAt
  // for sessions from before count dates existed).
  const locationIds = [order.fromLocationId, order.toLocationId].filter((l): l is string => !!l);
  const approvedCounts = locationIds.length
    ? await prisma.opnameSession.findMany({
        where: { status: "APPROVED", locationId: { in: locationIds } },
        select: { countDate: true, approvedAt: true },
      })
    : [];
  const floor = approvedCounts.reduce<Date | null>((acc, s) => {
    const d = s.countDate ?? s.approvedAt;
    if (!d) return acc;
    return !acc || d > acc ? d : acc;
  }, null);

  const verdict = isDateAllowed(proposed, floor, new Date());
  if (!verdict.ok) {
    const msg =
      verdict.reason === "future"
        ? "The date cannot be in the future"
        : `Can't date this before the stock count on ${fmt(floor!)}`;
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const oldDate = resolveEffectiveDate(order.effectiveDate, order.createdAt);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { effectiveDate: proposed } });
    await tx.movement.updateMany({ where: { orderId: id }, data: { effectiveDate: proposed } });
  });

  writeAuditLog({
    session,
    action: "EDIT_EFFECTIVE_DATE",
    description: `${order.orderNumber} (${order.type}): ${fmt(oldDate)} → ${fmt(proposed)} — "${reason.trim()}"`,
    entityId: id,
    entityType: "ORDER",
  });

  return NextResponse.json({ success: true });
}
