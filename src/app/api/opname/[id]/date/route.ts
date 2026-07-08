// ─────────────────────────────────────────────────────────────────────────────
// Backdated opname — set the count's business date and re-baseline the sheet.
//
// PATCH /api/opname/[id]/date   Body: { countDate: "YYYY-MM-DD", reason }
//
// Admin-only, allowed while the session is IN_PROGRESS or REVIEWING (never
// after approval). Setting the date recomputes every line's bookQty to the
// stock AS OF the end of that day (current balance minus all applied movements
// dated after it) and refreshes the differences of counted lines — so a count
// entered late still produces the correct adjustment. Stock itself is never
// touched here; only the comparison baseline changes.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import {
  parseCountDate,
  isFutureBusinessDay,
  sumDeltasByProduct,
  qtyAsOf,
  type AsOfMovement,
} from "@/lib/stock-asof";

export const maxDuration = 60;

const fmt = (d: Date) =>
  d.toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Only admins can change the count date" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const dateStr: unknown = body?.countDate;
  const reason: unknown = body?.reason;
  if (typeof dateStr !== "string")
    return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
  if (typeof reason !== "string" || !reason.trim())
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const proposed = parseCountDate(dateStr);
  if (!proposed)
    return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
  if (isFutureBusinessDay(proposed, new Date()))
    return NextResponse.json({ error: "The count date cannot be in the future" }, { status: 409 });

  const opnameSession = await prisma.opnameSession.findUnique({
    where: { id },
    select: {
      sessionNumber: true,
      status: true,
      locationId: true,
      createdAt: true,
      countDate: true,
      lines: { select: { id: true, productId: true, physicalQty: true, bookQty: true } },
    },
  });
  if (!opnameSession) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (opnameSession.status !== "IN_PROGRESS" && opnameSession.status !== "REVIEWING")
    return NextResponse.json(
      { error: "The count date can only be changed before the session is approved" },
      { status: 409 }
    );

  // Floor: the previous APPROVED count at this location — a new count can't be
  // dated before it (its baseline would overlap an already-settled period).
  const priorApproved = await prisma.opnameSession.findMany({
    where: { locationId: opnameSession.locationId, status: "APPROVED" },
    select: { countDate: true, approvedAt: true },
  });
  const floor = priorApproved.reduce<Date | null>((acc, s) => {
    const d = s.countDate ?? s.approvedAt;
    if (!d) return acc;
    return !acc || d > acc ? d : acc;
  }, null);
  if (floor && proposed < floor)
    return NextResponse.json(
      { error: `Can't date this count before the previous approved count (${fmt(floor)})` },
      { status: 409 }
    );

  // ── Re-baseline: bookQty per line = stock as of end of the count day ──────
  const productIds = opnameSession.lines.map((l) => l.productId);
  const [stockRows, movementRows] = await Promise.all([
    prisma.stock.findMany({
      where: { locationId: opnameSession.locationId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    }),
    prisma.movement.findMany({
      where: {
        productId: { in: productIds },
        OR: [
          { effectiveDate: { gt: proposed } },
          { effectiveDate: null, createdAt: { gt: proposed } },
        ],
        AND: [{ OR: [{ fromLocationId: opnameSession.locationId }, { toLocationId: opnameSession.locationId }] }],
      },
      select: {
        productId: true,
        quantity: true,
        fromLocationId: true,
        toLocationId: true,
        order: {
          select: {
            type: true,
            cancelledAt: true,
            grnStatus: true,
            goodsOutStatus: true,
            transferStatus: true,
            adjustmentStatus: true,
          },
        },
        orderLine: { select: { quantity: true } },
      },
    }),
  ]);

  const currentQty = new Map(stockRows.map((s) => [s.productId, s.quantity]));
  const asOfMovements: AsOfMovement[] = movementRows.map((m) => ({
    productId: m.productId,
    orderType: m.order.type as AsOfMovement["orderType"],
    cancelledAt: m.order.cancelledAt,
    grnStatus: m.order.grnStatus,
    goodsOutStatus: m.order.goodsOutStatus,
    transferStatus: m.order.transferStatus,
    adjustmentStatus: m.order.adjustmentStatus,
    fromLocationId: m.fromLocationId,
    toLocationId: m.toLocationId,
    quantity: m.quantity,
    lineQuantity: m.orderLine.quantity,
  }));
  const deltaAfter = sumDeltasByProduct(asOfMovements, opnameSession.locationId);

  // Only rewrite lines whose baseline actually changes.
  const updates = opnameSession.lines.flatMap((l) => {
    const newBook = qtyAsOf(currentQty.get(l.productId) ?? 0, deltaAfter.get(l.productId) ?? 0);
    if (newBook === l.bookQty) return [];
    const diff = l.physicalQty === null ? null : l.physicalQty - newBook;
    return [{ id: l.id, bookQty: newBook, difference: diff }];
  });

  try {
    await prisma.$transaction(async (tx) => {
      const CHUNK = 5000;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const slice = updates.slice(i, i + CHUNK);
        await tx.$executeRaw`
          UPDATE "OpnameLine" AS o
          SET "bookQty" = v.book, "difference" = v.diff
          FROM (VALUES ${Prisma.join(
            slice.map((u) => Prisma.sql`(${u.id}::text, ${u.bookQty}::int, ${u.difference}::int)`)
          )}) AS v(id, book, diff)
          WHERE o.id = v.id
        `;
      }
      await tx.opnameSession.update({ where: { id }, data: { countDate: proposed } });
    }, { timeout: 30000 });
  } catch (err) {
    console.error("[opname date] re-baseline failed", { sessionId: id, err });
    return NextResponse.json(
      { error: `Failed to change the count date: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const oldDate = opnameSession.countDate ?? opnameSession.createdAt;
  writeAuditLog({
    session,
    action: "EDIT_OPNAME_DATE",
    description: `Changed count date of ${opnameSession.sessionNumber}: ${fmt(oldDate)} → ${fmt(proposed)} — "${reason.trim()}" (${updates.length} baseline${updates.length !== 1 ? "s" : ""} recomputed)`,
    entityId: id,
    entityType: "OPNAME",
  });

  return NextResponse.json({ ok: true, countDate: proposed.toISOString(), rebaselined: updates.length });
}
