import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextOrderNumber } from "@/lib/order-number";
import { MovementType, Prisma } from "@/generated/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { viewerGuard } from "@/lib/role-guard";
import { sendPushNotification } from "@/modules/push-notify/send";
import { diffCountUpdates } from "@/lib/opname-counts";

export const maxDuration = 60;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const opnameSession = await prisma.opnameSession.findUnique({
    where: { id },
    include: {
      location: true,
      lines: {
        include: { product: { include: { category: true, unit: true } } },
        orderBy: { product: { name: "asc" } },
      },
    },
  });
  if (!opnameSession) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(opnameSession);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const vg = viewerGuard(session); if (vg) return vg;

  const { id } = await params;
  const body = await req.json();
  const { action, lines, notes } = body;

  const opnameSession = await prisma.opnameSession.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!opnameSession) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update physical counts on lines. Only write lines that actually changed —
  // a session can now hold every active product (1000+), so blindly updating
  // all of them per save would time out. A blank box means "not counted" (null,
  // difference null) so uncounted products are ignored on approval — never
  // recorded as a physical zero that would wipe their stock. (See opname-counts.)
  if (action === "update-counts" && lines) {
    const updates = diffCountUpdates(
      opnameSession.lines.map((ol) => ({ id: ol.id, physicalQty: ol.physicalQty, staffConfirmed: ol.staffConfirmed, bookQty: ol.bookQty })),
      lines as Array<{ id: string; physicalQty: number | null; staffConfirmed?: boolean }>
    );
    try {
      // ONE bulk UPDATE per chunk (UPDATE … FROM VALUES) instead of N individual
      // updates — a 1000+ line count would otherwise be 1000+ DB round-trips and
      // time out. 4 params/row; chunk well under Postgres' 65535-param limit.
      const CHUNK = 5000;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const slice = updates.slice(i, i + CHUNK);
        await prisma.$executeRaw`
          UPDATE "OpnameLine" AS o
          SET "physicalQty" = v.phys, "difference" = v.diff, "staffConfirmed" = v.sc
          FROM (VALUES ${Prisma.join(
            slice.map((u) => Prisma.sql`(${u.id}::text, ${u.physicalQty}::int, ${u.difference}::int, ${u.staffConfirmed}::boolean)`)
          )}) AS v(id, phys, diff, sc)
          WHERE o.id = v.id
        `;
      }
    } catch (err) {
      console.error("[opname update-counts] failed", { sessionId: id, changed: updates.length, err });
      return NextResponse.json(
        { error: `Save failed (${updates.length} changed): ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, saved: updates.length });
  }

  // Cancel with note (admin only, for REVIEWING sessions)
  if (action === "cancel") {
    if (session.user.role !== "ADMIN")
      return NextResponse.json({ error: "Only admins can cancel sessions" }, { status: 403 });
    const updated = await prisma.opnameSession.update({
      where: { id },
      data: { status: "CANCELLED", cancelNote: body.cancelNote ?? null },
    });
    writeAuditLog({ session, action: "CANCEL_OPNAME", description: `Cancelled opname ${opnameSession.sessionNumber}${body.cancelNote ? ` — ${body.cancelNote}` : ""}`, entityId: id, entityType: "OPNAME" });
    return NextResponse.json(updated);
  }

  // Submit for review
  if (action === "submit") {
    const updated = await prisma.opnameSession.update({
      where: { id },
      data: { status: "REVIEWING", notes },
    });
    return NextResponse.json(updated);
  }

  // Approve — create PENDING adjustment orders for all discrepancies.
  // Stock is NOT changed here; admin must separately approve each adjustment order.
  if (action === "approve") {
    if (session.user.role !== "ADMIN")
      return NextResponse.json({ error: "Only admins can approve opname sessions" }, { status: 403 });
    try {
    const fullSession = await prisma.opnameSession.findUnique({
      where: { id },
      include: { lines: { include: { product: true } } },
    });

    const discrepancies = fullSession!.lines.filter(
      (l) => l.physicalQty !== null && l.difference !== null && l.difference !== 0
    );

    // Generate order number before the transaction — nextOrderNumber uses the global
    // prisma client which shares the same single-connection pool; calling it inside
    // prisma.$transaction would deadlock because the transaction already holds the
    // one available connection.
    // Retry up to 3 times in case of order number collision (P2002 on orderNumber).
    let pendingOrderId: string | null = null;
    if (discrepancies.length > 0) {
      const MAX_RETRIES = 3;
      let attempt = 0;
      while (attempt < MAX_RETRIES) {
        const orderNumber = await nextOrderNumber("ADJUSTMENT");
        try {
          pendingOrderId = await prisma.$transaction(async (tx) => {
            // Business date for this opname-generated adjustment, stamped on the
            // order + its movements so they stay consistent. A backdated count
            // carries its countDate so the adjustment lands on the day the count
            // actually happened (reports, cost replay, freeze rules).
            const effectiveDate = fullSession!.countDate ?? new Date();
            const order = await tx.order.create({
              data: {
                orderNumber,
                type: "ADJUSTMENT",
                toLocationId: fullSession!.locationId,
                notes: `Stock Opname: ${fullSession!.sessionNumber}`,
                adjustmentStatus: "PENDING",
                adjustmentReason: "Stock Opname",
                createdByName: session.user.name ?? null,
                effectiveDate,
              },
            });

            // Bulk-insert all lines + movements (2 statements) instead of 2 per
            // discrepancy — a full 1000+ item count can produce hundreds of
            // discrepancies, and per-row creates blow past the 5s transaction
            // limit. Pre-generate ids so each movement links to its order line.
            // Signed quantity: positive = increase, negative = decrease (the
            // adjustment approval applies newQty = currentQty + quantity).
            const orderLinesData = discrepancies.map((line) => ({
              id: crypto.randomUUID(),
              orderId: order.id,
              productId: line.productId,
              quantity: line.difference!,
            }));
            await tx.orderLine.createMany({ data: orderLinesData });
            await tx.movement.createMany({
              data: orderLinesData.map((ol) => ({
                id: crypto.randomUUID(),
                orderId: order.id,
                orderLineId: ol.id,
                productId: ol.productId,
                toLocationId: fullSession!.locationId,
                quantity: Math.abs(ol.quantity),
                type: MovementType.ADJUSTMENT,
                effectiveDate,
              })),
            });
            // Stock NOT updated here — deferred to admin approval of the adjustment order
            return order.id;
          }, { timeout: 30000 });
          break; // success
        } catch (err) {
          const isCollision =
            err instanceof Error &&
            (err as { code?: string }).code === "P2002" &&
            JSON.stringify((err as { meta?: unknown }).meta).includes("orderNumber");
          if (isCollision && attempt < MAX_RETRIES - 1) {
            attempt++;
            continue;
          }
          throw err;
        }
      }
    }

    const updated = await prisma.opnameSession.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedByName: session.user.name ?? null },
    });

    writeAuditLog({ session, action: "APPROVE_OPNAME", description: `Approved opname ${fullSession!.sessionNumber} — ${discrepancies.length} adjustment(s) pending review`, entityId: id, entityType: "OPNAME" });

    if (pendingOrderId) {
      sendPushNotification({
        title: `⚖️ Adjustment Pending Review — ${fullSession!.sessionNumber}`,
        body: `${discrepancies.length} item${discrepancies.length !== 1 ? "s" : ""} need stock adjustment confirmation`,
        url: `/orders/${pendingOrderId}`,
      }).catch(() => {});
    }

    return NextResponse.json({ ...updated, pendingOrderId });
    } catch (err) {
      console.error("[opname approve] failed", { sessionId: id, err });
      return NextResponse.json(
        { error: `Approve failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const opnameSession = await prisma.opnameSession.findUnique({ where: { id } });
  if (!opnameSession) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Non-IN_PROGRESS sessions require ADMIN role
  if (opnameSession.status !== "IN_PROGRESS" && session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Only admins can delete completed sessions" }, { status: 403 });

  // Deleting an APPROVED session only removes the opname record — the adjustment
  // orders that were applied on approval remain intact in the orders history.
  await prisma.opnameSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
