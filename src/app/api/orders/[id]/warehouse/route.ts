import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { InsufficientStockError } from "@/lib/stock";
import { resolveEffectiveDate } from "@/lib/effective-date";
import {
  computeRecalibrationDeltas,
  resultingNegatives,
  validateWarehouseChange,
  keyOf,
  type WhOrderType,
} from "@/lib/warehouse-change";

const JAKARTA_TZ = "Asia/Jakarta";
const fmtDate = (d: Date) => d.toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: JAKARTA_TZ });

// PATCH /api/orders/[id]/warehouse
// Body: { fromLocationId?, toLocationId?, reason, confirm? }
// Admin-only. Changes the order's warehouse(s) and recalibrates stock: reverse at
// the old warehouse, re-apply at the new one, in one transaction. Rejects (409) if
// any affected warehouse would go negative. Warns (200 + { warning }) — unless
// confirm:true — when an approved opname would be retroactively altered.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const reason: unknown = body?.reason;
  const confirm = body?.confirm === true;
  if (typeof reason !== "string" || !reason.trim())
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id },
    include: { lines: { select: { productId: true, quantity: true } } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.cancelledAt) return NextResponse.json({ error: "Cancelled orders cannot be changed" }, { status: 409 });

  const type = order.type as WhOrderType;

  // Rejected orders never applied stock and can't be edited. Approved ones CAN —
  // recalibrating them is the whole point of this feature.
  const rejected =
    (type === "GRN" && order.grnStatus === "REJECTED") ||
    (type === "GOODS_OUT" && order.goodsOutStatus === "REJECTED") ||
    (type === "TRANSFER" && order.transferStatus === "REJECTED") ||
    (type === "ADJUSTMENT" && order.adjustmentStatus === "REJECTED");
  if (rejected) return NextResponse.json({ error: "Rejected orders cannot be changed" }, { status: 400 });

  // Resolve the intended final warehouses (fall back to current where not provided).
  const newFrom = body?.fromLocationId !== undefined ? (body.fromLocationId || null) : order.fromLocationId;
  const newTo = body?.toLocationId !== undefined ? (body.toLocationId || null) : order.toLocationId;

  const activeLocations = await prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  const nameOf = new Map<string, string>(activeLocations.map((l) => [l.id, l.name]));
  const oldFromName = await locName(order.fromLocationId, nameOf);
  const oldToName = await locName(order.toLocationId, nameOf);

  const verdict = validateWarehouseChange({
    type,
    oldFrom: order.fromLocationId,
    oldTo: order.toLocationId,
    newFrom,
    newTo,
    activeLocationIds: activeLocations.map((l) => l.id),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });

  const effectiveDate = resolveEffectiveDate(order.effectiveDate, order.createdAt);

  // Opname soft-warn: an APPROVED count after this order's date, at any affected
  // warehouse, would be retroactively altered. Admin confirms to override.
  const affected = [order.fromLocationId, order.toLocationId, newFrom, newTo].filter((l): l is string => !!l);
  const opAgg = await prisma.opnameSession.aggregate({
    _max: { approvedAt: true },
    where: { status: "APPROVED", locationId: { in: affected } },
  });
  const opnameDate = opAgg._max.approvedAt;
  if (opnameDate && opnameDate > effectiveDate && !confirm) {
    return NextResponse.json(
      { warning: "opname", opnameDate: opnameDate.toISOString(), opnameDateLabel: fmtDate(opnameDate) },
      { status: 200 }
    );
  }

  // Pending orders never applied stock — change is metadata-only (re-point below).
  const skipStock =
    (type === "GRN" && order.grnStatus === "PENDING") ||
    (type === "GOODS_OUT" && order.goodsOutStatus === "PENDING") ||
    (type === "TRANSFER" && order.transferStatus === "PENDING") ||
    (type === "ADJUSTMENT" && order.adjustmentStatus === "PENDING");

  const deltas = skipStock
    ? []
    : computeRecalibrationDeltas({ type, oldFrom: order.fromLocationId, oldTo: order.toLocationId, newFrom, newTo, lines: order.lines });

  try {
    await prisma.$transaction(
      async (tx) => {
        if (deltas.length) {
          const productIds = [...new Set(deltas.map((d) => d.productId))];
          const locationIds = [...new Set(deltas.map((d) => d.locationId))];
          const rows = await tx.stock.findMany({
            where: { productId: { in: productIds }, locationId: { in: locationIds } },
            select: { productId: true, locationId: true, quantity: true },
          });
          const current: Record<string, number> = {};
          for (const r of rows) current[keyOf(r.productId, r.locationId)] = r.quantity;

          const negs = resultingNegatives(current, deltas);
          if (negs.length) {
            const n = negs[0];
            const [prod, loc] = await Promise.all([
              tx.product.findUnique({ where: { id: n.productId }, select: { name: true, sku: true } }),
              tx.location.findUnique({ where: { id: n.locationId }, select: { name: true } }),
            ]);
            throw new InsufficientStockError(
              `${loc?.name ?? n.locationId} would go negative on "${prod?.name ?? n.productId}"${prod?.sku ? ` (${prod.sku})` : ""}: result ${n.resulting}`
            );
          }

          for (const d of deltas) {
            await tx.stock.upsert({
              where: { productId_locationId: { productId: d.productId, locationId: d.locationId } },
              create: { productId: d.productId, locationId: d.locationId, quantity: d.delta },
              update: { quantity: { increment: d.delta } },
            });
          }
        }

        await tx.order.update({ where: { id }, data: { fromLocationId: newFrom, toLocationId: newTo } });
        await tx.movement.updateMany({ where: { orderId: id }, data: { fromLocationId: newFrom, toLocationId: newTo } });
      },
      { timeout: 20000, maxWait: 15000 }
    );
  } catch (err) {
    if (err instanceof InsufficientStockError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("Warehouse change failed:", err);
    return NextResponse.json({ error: "Failed to change warehouse — please try again" }, { status: 500 });
  }

  const change =
    type === "GOODS_OUT"
      ? `source ${oldFromName} → ${await locName(newFrom, nameOf)}`
      : type === "TRANSFER"
        ? `from ${oldFromName} → ${await locName(newFrom, nameOf)}, to ${oldToName} → ${await locName(newTo, nameOf)}`
        : `destination ${oldToName} → ${await locName(newTo, nameOf)}`;
  writeAuditLog({
    session,
    action: "CHANGE_ORDER_WAREHOUSE",
    description: `${order.orderNumber} (${order.type}): ${change} — "${reason.trim()}"`,
    entityId: id,
    entityType: "ORDER",
  });

  return NextResponse.json({ success: true });
}

// Resolve a location name, falling back to a lookup for inactive/legacy locations.
async function locName(locId: string | null, cache: Map<string, string>): Promise<string> {
  if (!locId) return "—";
  const hit = cache.get(locId);
  if (hit) return hit;
  const loc = await prisma.location.findUnique({ where: { id: locId }, select: { name: true } });
  const name = loc?.name ?? locId;
  cache.set(locId, name);
  return name;
}
