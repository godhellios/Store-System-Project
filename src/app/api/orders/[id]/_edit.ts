import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MovementType, OrderType } from "@/generated/prisma";
import { resolveEffectiveDate } from "@/lib/effective-date";
import { InsufficientStockError } from "@/lib/stock";

const MOVEMENT_TYPE: Record<OrderType, MovementType> = {
  GRN: MovementType.IN,
  GOODS_OUT: MovementType.OUT,
  TRANSFER: MovementType.TRANSFER,
  ADJUSTMENT: MovementType.ADJUSTMENT,
};

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "STAFF"].includes(session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.order.findUnique({ where: { id } });
  if (existing?.type === "ADJUSTMENT" && existing.adjustmentStatus !== "PENDING")
    return NextResponse.json({ error: "Approved or rejected adjustments cannot be edited" }, { status: 400 });
  if (existing?.type === "GRN" && existing.grnStatus === "REJECTED")
    return NextResponse.json({ error: "Rejected GRN orders cannot be edited" }, { status: 400 });
  if (existing?.type === "GOODS_OUT" && existing.goodsOutStatus === "REJECTED")
    return NextResponse.json({ error: "Rejected Goods Out orders cannot be edited" }, { status: 400 });
  if (existing?.type === "TRANSFER" && existing.transferStatus === "REJECTED")
    return NextResponse.json({ error: "Rejected Transfer orders cannot be edited" }, { status: 400 });

  const body = await req.json();
  const { customer, supplier, reference, notes, lines } = body as {
    customer?: string | null;
    supplier?: string | null;
    reference?: string | null;
    notes?: string | null;
    lines?: Array<{ productId: string; quantity: number; inputQty?: number; inputUnit?: string; notes?: string | null }>;
  };

  if (lines !== undefined) {
    if (!lines.length) return NextResponse.json({ error: "At least one line is required" }, { status: 400 });

    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({ where: { id }, include: { lines: true } });
        if (!current) throw new Error("Order not found");

        const skipStock =
          (current.type === "ADJUSTMENT" && current.adjustmentStatus === "PENDING") ||
          (current.type === "GRN"        && current.grnStatus        === "PENDING") ||
          (current.type === "GOODS_OUT"  && current.goodsOutStatus   === "PENDING") ||
          (current.type === "TRANSFER"   && current.transferStatus   === "PENDING");

        // 1. Reverse stock for existing lines
        for (const old of current.lines) {
          if (skipStock) continue;
          if (current.type === "GRN" && current.toLocationId) {
            await tx.stock.updateMany({ where: { productId: old.productId, locationId: current.toLocationId }, data: { quantity: { decrement: old.quantity } } });
          } else if (current.type === "GOODS_OUT" && current.fromLocationId) {
            await tx.stock.updateMany({ where: { productId: old.productId, locationId: current.fromLocationId }, data: { quantity: { increment: old.quantity } } });
          } else if (current.type === "TRANSFER" && current.fromLocationId && current.toLocationId) {
            await tx.stock.updateMany({ where: { productId: old.productId, locationId: current.fromLocationId }, data: { quantity: { increment: old.quantity } } });
            await tx.stock.updateMany({ where: { productId: old.productId, locationId: current.toLocationId }, data: { quantity: { decrement: old.quantity } } });
          } else if (current.type === "ADJUSTMENT" && current.toLocationId) {
            await tx.stock.updateMany({ where: { productId: old.productId, locationId: current.toLocationId }, data: { quantity: { decrement: old.quantity } } });
          }
        }

        // 2. Delete old movements and lines
        await tx.movement.deleteMany({ where: { orderId: id } });
        await tx.orderLine.deleteMany({ where: { orderId: id } });

        // 3. Update order metadata
        await tx.order.update({
          where: { id },
          data: {
            ...(customer  !== undefined ? { customer:  customer?.trim()  || null } : {}),
            ...(supplier  !== undefined ? { supplier:  supplier?.trim()  || null } : {}),
            ...(reference !== undefined ? { reference: reference?.trim() || null } : {}),
            ...(notes     !== undefined ? { notes:     notes?.trim()     || null } : {}),
          },
        });

        // 4. Create new lines + movements (batched — two round-trips, not per line)
        const newRows = lines!.map((line) => ({
          id: crypto.randomUUID(),
          orderId: id,
          productId: line.productId,
          quantity: line.quantity,
          inputQty: line.inputQty ?? null,
          inputUnit: line.inputUnit ?? null,
          notes: line.notes?.trim() || null,
        }));
        // Editing line items must NOT re-date the transaction: keep the order's
        // original business date (falling back to createdAt for legacy orders).
        const movementEffectiveDate = resolveEffectiveDate(current.effectiveDate, current.createdAt);
        await tx.orderLine.createMany({ data: newRows });
        await tx.movement.createMany({
          data: newRows.map((lr) => ({
            orderId: id,
            orderLineId: lr.id,
            productId: lr.productId,
            fromLocationId: current.fromLocationId ?? null,
            toLocationId: current.toLocationId ?? null,
            quantity: lr.quantity,
            type: MOVEMENT_TYPE[current.type],
            effectiveDate: movementEffectiveDate,
          })),
        });

        // 5. Apply stock per line (immediate orders only)
        const touchedProductIds = [...new Set([
          ...current.lines.map((l) => l.productId),
          ...lines!.map((l) => l.productId),
        ])];
        for (const line of lines!) {
          if (!skipStock) {
            if (current.type === "GRN" && current.toLocationId) {
              await tx.stock.upsert({
                where: { productId_locationId: { productId: line.productId, locationId: current.toLocationId } },
                create: { productId: line.productId, locationId: current.toLocationId, quantity: line.quantity },
                update: { quantity: { increment: line.quantity } },
              });
            } else if (current.type === "GOODS_OUT" && current.fromLocationId) {
              await tx.stock.update({
                where: { productId_locationId: { productId: line.productId, locationId: current.fromLocationId } },
                data: { quantity: { decrement: line.quantity } },
              });
            } else if (current.type === "TRANSFER" && current.fromLocationId && current.toLocationId) {
              await tx.stock.update({
                where: { productId_locationId: { productId: line.productId, locationId: current.fromLocationId } },
                data: { quantity: { decrement: line.quantity } },
              });
              await tx.stock.upsert({
                where: { productId_locationId: { productId: line.productId, locationId: current.toLocationId } },
                create: { productId: line.productId, locationId: current.toLocationId, quantity: line.quantity },
                update: { quantity: { increment: line.quantity } },
              });
            }
          }
        }

        // 6. Guard: the reverse+reapply above must not leave any touched balance
        // negative (e.g. editing a live GOODS_OUT beyond available stock, or
        // shrinking a GRN whose goods were already consumed). Throwing here rolls
        // back the whole edit.
        if (!skipStock) {
          const touchedLocationIds = [current.fromLocationId, current.toLocationId].filter((l): l is string => !!l);
          if (touchedLocationIds.length) {
            const negative = await tx.stock.findMany({
              where: {
                productId: { in: touchedProductIds },
                locationId: { in: touchedLocationIds },
                quantity: { lt: 0 },
              },
              include: { product: { select: { name: true, sku: true } }, location: { select: { name: true } } },
            });
            if (negative.length) {
              throw new InsufficientStockError(
                `Edit would make stock negative:\n${negative
                  .map((s) => `"${s.product.name}" (${s.product.sku}) at ${s.location.name}: ${s.quantity}`)
                  .join("\n")}`
              );
            }
          }
        }
      }, { timeout: 20000, maxWait: 15000 });
    } catch (err) {
      if (err instanceof InsufficientStockError)
        return NextResponse.json({ error: err.message }, { status: 400 });
      console.error("Order update failed:", err);
      return NextResponse.json({ error: "Failed to update order — please try again" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // Metadata-only update
  const { lineNotes } = body as { lineNotes?: Array<{ id: string; notes: string | null }> };
  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: {
        ...(customer  !== undefined ? { customer:  customer?.trim()  || null } : {}),
        ...(reference !== undefined ? { reference: reference?.trim() || null } : {}),
        ...(notes     !== undefined ? { notes:     notes?.trim()     || null } : {}),
      },
    });
    if (lineNotes?.length) {
      for (const ln of lineNotes) {
        await tx.orderLine.update({ where: { id: ln.id }, data: { notes: ln.notes?.trim() || null } });
      }
    }
    return updated;
  });
  return NextResponse.json(order);
}
