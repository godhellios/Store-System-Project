import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MovementType, OrderType } from "@/generated/prisma";
// ── push-notify module ──────────────────────────────────────────────────────
import { sendPushNotification } from "@/modules/push-notify/send";
// ────────────────────────────────────────────────────────────────────────────
import { writeAuditLog } from "@/lib/audit-log";
import { viewerGuard } from "@/lib/role-guard";

// Large orders do meaningful work in one transaction — give the function room
// well beyond the platform default so a big order is never killed mid-save.
export const maxDuration = 60;

const ORDER_PREFIX: Record<string, string> = {
  GRN: "GRN", GOODS_OUT: "OUT", TRANSFER: "TRF", ADJUSTMENT: "ADJ",
};

// Toggle approval requirement per order type.
// Set to false to bypass approval and apply stock immediately.
const REQUIRE_APPROVAL = { GRN: true, GOODS_OUT: true, TRANSFER: true } as const;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as OrderType | null;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = 20;

  const where = { ...(type ? { type } : {}) };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        fromLocation: true,
        toLocation: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pages: Math.ceil(total / perPage) });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const vg = viewerGuard(session); if (vg) return vg;

  const body = await req.json();
  const { type, fromLocationId, toLocationId, customer, supplier, supplierId, reference, notes, lines } = body as {
    type: OrderType;
    fromLocationId?: string;
    toLocationId?: string;
    customer?: string;
    supplier?: string;
    supplierId?: string;
    reference?: string;
    notes?: string;
    lines: Array<{ productId: string; quantity: number; inputQty?: number; inputUnit?: string; notes?: string }>;
  };

  if (!type) return NextResponse.json({ error: "Type is required" }, { status: 400 });
  if (!lines?.length) return NextResponse.json({ error: "At least one line is required" }, { status: 400 });
  if ((type === "GRN" || type === "ADJUSTMENT") && !toLocationId)
    return NextResponse.json({ error: "Destination location is required" }, { status: 400 });
  if (type === "GOODS_OUT" && !fromLocationId)
    return NextResponse.json({ error: "Source location is required" }, { status: 400 });
  if (type === "TRANSFER" && (!fromLocationId || !toLocationId))
    return NextResponse.json({ error: "Both source and destination locations are required" }, { status: 400 });
  if (type === "TRANSFER" && fromLocationId === toLocationId)
    return NextResponse.json({ error: "Source and destination locations must be different" }, { status: 400 });

  if (type === "GRN") {
    const productIds = lines.map((l) => l.productId);
    const inactive = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: false },
      select: { name: true },
    });
    if (inactive.length > 0)
      return NextResponse.json(
        { error: `Cannot receive deactivated product(s): ${inactive.map((p) => p.name).join(", ")}` },
        { status: 400 }
      );
  }

  const MOVEMENT_TYPE: Record<OrderType, MovementType> = {
    GRN: MovementType.IN,
    GOODS_OUT: MovementType.OUT,
    TRANSFER: MovementType.TRANSFER,
    ADJUSTMENT: MovementType.ADJUSTMENT,
  };

  // ── Pre-validate stock for GOODS_OUT and TRANSFER ──────────────────────────
  if (type === "GOODS_OUT" || type === "TRANSFER") {
    const locationId = fromLocationId!;
    const stockRecords = await prisma.stock.findMany({
      where: { productId: { in: lines.map((l) => l.productId) }, locationId },
      include: { product: true },
    });
    const stockMap = new Map(stockRecords.map((s) => [s.productId, s]));
    const insufficient: string[] = [];
    for (const line of lines) {
      const available = stockMap.get(line.productId)?.quantity ?? 0;
      if (available < line.quantity) {
        const name = stockMap.get(line.productId)?.product.name ?? line.productId;
        insufficient.push(`"${name}" — available: ${available}, requested: ${line.quantity}`);
      }
    }
    if (insufficient.length > 0)
      return NextResponse.json(
        { error: `Insufficient stock:\n${insufficient.join("\n")}` },
        { status: 400 }
      );
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Block transactions while an opname session is open for affected location ─
  if (type !== "ADJUSTMENT") {
    const affectedLocationIds = [...new Set([fromLocationId, toLocationId].filter(Boolean))] as string[];
    const openOpname = await prisma.opnameSession.findFirst({
      where: { locationId: { in: affectedLocationIds }, status: { in: ["IN_PROGRESS", "REVIEWING"] } },
      include: { location: true },
    });
    if (openOpname) {
      return NextResponse.json(
        { error: `Cannot create transaction: ${openOpname.location.name} has an open stock opname session (${openOpname.sessionNumber}). Complete or cancel the opname first.` },
        { status: 409 }
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const { adjustmentReason } = body as { adjustmentReason?: string };
  const isManualAdjustment = type === "ADJUSTMENT";
  const isAdmin = session.user.role === "ADMIN";
  const warnings: string[] = [];

  let result!: { order: { id: string; orderNumber: string; fromLocationId: string | null }; txWarnings: string[] };
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const txWarnings: string[] = [];
        const prefix = ORDER_PREFIX[type] ?? "ORD";
        const year = new Date().getFullYear();
        const last = await tx.order.findFirst({
          where: { orderNumber: { startsWith: `${prefix}-${year}-` } },
          orderBy: { orderNumber: "desc" },
          select: { orderNumber: true },
        });
        const lastNum = last ? parseInt(last.orderNumber.split("-").pop() ?? "0") : 0;
        const orderNumber = `${prefix}-${year}-${String(lastNum + 1).padStart(4, "0")}`;

        // Business date for this transaction (when it really happened). Captured once
        // and stamped on the order + all its movements so they stay consistent.
        const effectiveDate = new Date();
        const order = await tx.order.create({
        data: {
          orderNumber, type, fromLocationId, toLocationId, customer, supplier, supplierId: supplierId || null, reference, notes,
          createdByName: session.user.name ?? null,
          effectiveDate,
          ...(isManualAdjustment ? { adjustmentStatus: "PENDING", adjustmentReason: adjustmentReason ?? null } : {}),
          ...(type === "GRN" && !isAdmin ? { grnStatus: "PENDING" } : {}),
          ...(type === "GOODS_OUT" && REQUIRE_APPROVAL.GOODS_OUT && !isAdmin ? { goodsOutStatus: "PENDING" } : {}),
          ...(type === "TRANSFER" && REQUIRE_APPROVAL.TRANSFER && !isAdmin ? { transferStatus: "PENDING" } : {}),
        },
      });

      // Lock stock rows inside the transaction — prevents concurrent GOODS_OUT/TRANSFER from
      // both passing the outer pre-check and both decrementing past zero.
      if ((type === "GOODS_OUT" || type === "TRANSFER") && fromLocationId) {
        const productIds = lines.map((l) => l.productId);
        const lockedStock = await tx.$queryRaw<Array<{ productId: string; quantity: number }>>`
          SELECT "productId", quantity FROM "Stock"
          WHERE "productId" = ANY(${productIds}::text[]) AND "locationId" = ${fromLocationId}
          FOR UPDATE
        `;
        const stockMap = new Map(lockedStock.map((s) => [s.productId, s.quantity]));
        for (const line of lines) {
          const available = stockMap.get(line.productId) ?? 0;
          if (available < line.quantity) {
            throw new Error(`Insufficient stock: available ${available}, requested ${line.quantity} (product ${line.productId})`);
          }
        }
      }

      // Batch the line + movement inserts into two round-trips (instead of two
      // per line) so large orders stay well under the transaction timeout.
      // Pre-generate OrderLine ids so each Movement can reference its line.
      const lineRows = lines.map((line) => ({
        id: crypto.randomUUID(),
        orderId: order.id,
        productId: line.productId,
        quantity: line.quantity,
        inputQty: line.inputQty ?? null,
        inputUnit: line.inputUnit ?? null,
        notes: line.notes ?? null,
      }));
      await tx.orderLine.createMany({ data: lineRows });
      await tx.movement.createMany({
        data: lineRows.map((lr) => ({
          orderId: order.id,
          orderLineId: lr.id,
          productId: lr.productId,
          fromLocationId: fromLocationId ?? null,
          toLocationId: toLocationId ?? null,
          quantity: Math.abs(lr.quantity),
          type: MOVEMENT_TYPE[type],
          effectiveDate,
        })),
      });

      // Stock side-effects (immediate cases only; deferred ones wait for approval).
      for (const line of lines) {
        if (type === "GRN") {
          if (isAdmin) {
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: toLocationId! } },
              create: { productId: line.productId, locationId: toLocationId!, quantity: line.quantity },
              update: { quantity: { increment: line.quantity } },
            });
          }
          // else: stock deferred — applied only when admin approves
        } else if (type === "GOODS_OUT") {
          if (!REQUIRE_APPROVAL.GOODS_OUT || isAdmin) {
            await tx.stock.update({
              where: { productId_locationId: { productId: line.productId, locationId: fromLocationId! } },
              data: { quantity: { decrement: line.quantity } },
            });
          }
          // else: stock deferred until admin approves
        } else if (type === "TRANSFER") {
          if (!REQUIRE_APPROVAL.TRANSFER || isAdmin) {
            await tx.stock.update({
              where: { productId_locationId: { productId: line.productId, locationId: fromLocationId! } },
              data: { quantity: { decrement: line.quantity } },
            });
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: toLocationId! } },
              create: { productId: line.productId, locationId: toLocationId!, quantity: line.quantity },
              update: { quantity: { increment: line.quantity } },
            });
          }
          // else: stock deferred until admin approves
        }
        // ADJUSTMENT: stock NOT updated here — deferred until admin approves
      }

        return { order, txWarnings };
      }, { timeout: 20000, maxWait: 15000 });
      break; // success — exit retry loop
    } catch (err) {
      const isOrderNumberCollision =
        err instanceof Error &&
        (err as { code?: string }).code === "P2002" &&
        JSON.stringify((err as { meta?: unknown }).meta).includes("orderNumber");
      if (isOrderNumberCollision && attempt < MAX_RETRIES - 1) {
        attempt++;
        continue;
      }
      const message = err instanceof Error ? err.message : "Failed to create order — please try again";
      console.error("Order creation failed:", err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  warnings.push(...result.txWarnings);

  // ── push-notify module ──────────────────────────────────────────────────
  const totalQtyNotify = lines.reduce((s, l) => s + l.quantity, 0);
  if (type === "GRN" && !isAdmin) {
    sendPushNotification({
      title: `📥 GRN Pending Approval — ${result.order.orderNumber}`,
      body: `${lines.length} item${lines.length !== 1 ? "s" : ""} · ${totalQtyNotify} units — awaiting admin approval before stock is credited`,
      url: `/orders/${result.order.id}`,
    }).catch(() => {});
  }
  if (type === "GOODS_OUT") {
    const fromName = result.order.fromLocationId
      ? await prisma.location.findUnique({ where: { id: result.order.fromLocationId }, select: { name: true } })
          .then((l) => l?.name ?? "")
          .catch(() => "")
      : "";
    if (REQUIRE_APPROVAL.GOODS_OUT && !isAdmin) {
      sendPushNotification({
        title: `🚚 Goods Out Pending Approval — ${result.order.orderNumber}`,
        body: `${lines.length} item${lines.length !== 1 ? "s" : ""} · ${totalQtyNotify} units${fromName ? ` from ${fromName}` : ""} — awaiting admin approval`,
        url: `/orders/${result.order.id}`,
      }).catch(() => {});
    } else {
      sendPushNotification({
        title: `🚚 Goods Out — ${result.order.orderNumber}`,
        body: `${lines.length} item${lines.length !== 1 ? "s" : ""} · ${totalQtyNotify} units dispatched${fromName ? ` from ${fromName}` : ""}`,
        url: `/orders/${result.order.id}`,
      }).catch(() => {});
    }
  }
  if (type === "ADJUSTMENT") {
    sendPushNotification({
      title: `⚖️ Adjustment Pending Approval — ${result.order.orderNumber}`,
      body: `${lines.length} item${lines.length !== 1 ? "s" : ""} · ${totalQtyNotify} units — awaiting admin approval before stock is adjusted`,
      url: `/orders/${result.order.id}`,
    }).catch(() => {});
  }
  if (type === "TRANSFER" && REQUIRE_APPROVAL.TRANSFER && !isAdmin) {
    const fromName = result.order.fromLocationId
      ? await prisma.location.findUnique({ where: { id: result.order.fromLocationId }, select: { name: true } })
          .then((l) => l?.name ?? "")
          .catch(() => "")
      : "";
    sendPushNotification({
      title: `🔄 Transfer Pending Approval — ${result.order.orderNumber}`,
      body: `${lines.length} item${lines.length !== 1 ? "s" : ""} · ${totalQtyNotify} units${fromName ? ` from ${fromName}` : ""} — awaiting admin approval`,
      url: `/orders/${result.order.id}`,
    }).catch(() => {});
  }

  // ── Reorder point alerts ─────────────────────────────────────────────────
  // Only fire after immediate stock decrements (when approval is bypassed)
  const stockAppliedNow = (type === "GOODS_OUT" && (!REQUIRE_APPROVAL.GOODS_OUT || isAdmin)) || (type === "TRANSFER" && (!REQUIRE_APPROVAL.TRANSFER || isAdmin));
  if (stockAppliedNow && fromLocationId) {
    const productIds = lines.map((l) => l.productId);
    prisma.stock.findMany({
      where: {
        productId: { in: productIds },
        locationId: fromLocationId,
        product: { reorderPoint: { gt: 0 } },
      },
      include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
    }).then((stockRows) => {
      const belowReorder = stockRows.filter((s) => s.quantity <= s.product.reorderPoint);
      if (!belowReorder.length) return;
      const itemList = belowReorder
        .map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`)
        .join(", ");
      sendPushNotification({
        title: `⚠️ Low Stock Alert — ${belowReorder.length} item${belowReorder.length !== 1 ? "s" : ""} at reorder point`,
        body: itemList,
        url: `/dashboard`,
      });
    }).catch(() => {});
  }
  // ─────────────────────────────────────────────────────────────────────────

  const actionLabel: Record<string, string> = {
    GRN: "CREATE_GRN", GOODS_OUT: "CREATE_GOODS_OUT", TRANSFER: "CREATE_TRANSFER", ADJUSTMENT: "CREATE_ADJUSTMENT",
  };
  writeAuditLog({
    session,
    action: actionLabel[type] ?? "CREATE_ORDER",
    description: `${result.order.orderNumber} — ${lines.length} line${lines.length !== 1 ? "s" : ""}${(isManualAdjustment || (!isAdmin && (type === "GRN" || (type === "GOODS_OUT" && REQUIRE_APPROVAL.GOODS_OUT) || (type === "TRANSFER" && REQUIRE_APPROVAL.TRANSFER)))) ? " (pending approval)" : ""}`,
    entityId: result.order.id,
    entityType: "ORDER",
  });

  return NextResponse.json({ order: result.order, warnings }, { status: 201 });
}
