import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MovementType, OrderType } from "@/generated/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { sendPushNotification } from "@/modules/push-notify/send";

const MOVEMENT_TYPE: Record<OrderType, MovementType> = {
  GRN: MovementType.IN,
  GOODS_OUT: MovementType.OUT,
  TRANSFER: MovementType.TRANSFER,
  ADJUSTMENT: MovementType.ADJUSTMENT,
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      fromLocation: true,
      toLocation: true,
      lines: {
        include: { product: { include: { category: true, unit: true } } },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(order);
}

// ── Approve or reject a PENDING adjustment or GRN ─────────────────────────
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Only admins can approve or reject orders" }, { status: 403 });

  const { id } = await params;
  const { action, note } = (await req.json()) as { action: "approve" | "reject"; note?: string };
  if (!["approve", "reject"].includes(action))
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isPendingAdjustment = order.type === "ADJUSTMENT" && order.adjustmentStatus === "PENDING";
  const isPendingGrn = order.type === "GRN" && order.grnStatus === "PENDING";
  const isPendingGoodsOut = order.type === "GOODS_OUT" && order.goodsOutStatus === "PENDING";
  const isPendingTransfer = order.type === "TRANSFER" && order.transferStatus === "PENDING";
  if (!isPendingAdjustment && !isPendingGrn && !isPendingGoodsOut && !isPendingTransfer)
    return NextResponse.json({ error: "Only pending orders can be reviewed" }, { status: 400 });

  const reviewFields = { reviewedByName: session.user.name ?? null, reviewedAt: new Date(), reviewNote: note ?? null };

  // ── GRN approve / reject ──────────────────────────────────────────────────
  if (isPendingGrn) {
    if (action === "approve") {
      // Re-validate: products must still be active at approval time
      const productIds = order.lines.map((l) => l.productId);
      const inactiveProducts = await prisma.product.findMany({
        where: { id: { in: productIds }, isActive: false },
        select: { name: true, sku: true },
      });
      if (inactiveProducts.length > 0) {
        return NextResponse.json({
          error: `Cannot approve: the following products were deactivated after this GRN was submitted: ${inactiveProducts.map((p) => `"${p.name}" (${p.sku})`).join(", ")}`,
        }, { status: 400 });
      }

      // Re-validate: destination location must still be active
      if (order.toLocationId) {
        const location = await prisma.location.findUnique({
          where: { id: order.toLocationId },
          select: { name: true, isActive: true },
        });
        if (!location?.isActive) {
          return NextResponse.json({
            error: `Cannot approve: destination location${location ? ` "${location.name}"` : ""} is no longer active`,
          }, { status: 400 });
        }
      }

      await prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          if (!order.toLocationId) continue;
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: order.toLocationId } },
            create: { productId: line.productId, locationId: order.toLocationId, quantity: line.quantity },
            update: { quantity: { increment: line.quantity } },
          });
        }
        await tx.order.update({ where: { id }, data: { grnStatus: "APPROVED", ...reviewFields } });
      });
      writeAuditLog({ session, action: "APPROVE_GRN", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    } else {
      await prisma.order.update({ where: { id }, data: { grnStatus: "REJECTED", ...reviewFields } });
      writeAuditLog({ session, action: "REJECT_GRN", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    }
    return NextResponse.json({ success: true });
  }

  // ── Goods Out approve / reject ────────────────────────────────────────────
  if (isPendingGoodsOut) {
    if (action === "approve") {
      if (order.fromLocationId) {
        // Re-validate stock at approval time (stock may have changed since order was created)
        const stockRows = await prisma.stock.findMany({
          where: { productId: { in: order.lines.map((l) => l.productId) }, locationId: order.fromLocationId },
          include: { product: { select: { name: true } } },
        });
        const stockMap = new Map(stockRows.map((s) => [s.productId, s]));
        const insufficient: string[] = [];
        for (const line of order.lines) {
          const available = stockMap.get(line.productId)?.quantity ?? 0;
          if (available < line.quantity) {
            const name = stockMap.get(line.productId)?.product.name ?? line.productId;
            insufficient.push(`"${name}" — available: ${available}, requested: ${line.quantity}`);
          }
        }
        if (insufficient.length)
          return NextResponse.json({ error: `Insufficient stock:\n${insufficient.join("\n")}` }, { status: 400 });
      }
      await prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          if (!order.fromLocationId) continue;
          await tx.stock.update({
            where: { productId_locationId: { productId: line.productId, locationId: order.fromLocationId } },
            data: { quantity: { decrement: line.quantity } },
          });
        }
        await tx.order.update({ where: { id }, data: { goodsOutStatus: "APPROVED", ...reviewFields } });
      });
      writeAuditLog({ session, action: "APPROVE_GOODS_OUT", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
      // Fire reorder alerts after stock decrement
      if (order.fromLocationId) {
        prisma.stock.findMany({
          where: { productId: { in: order.lines.map((l) => l.productId) }, locationId: order.fromLocationId, product: { reorderPoint: { gt: 0 } } },
          include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
        }).then((stockRows) => {
          const belowReorder = stockRows.filter((s) => s.quantity <= s.product.reorderPoint);
          if (!belowReorder.length) return;
          sendPushNotification({
            title: `⚠️ Low Stock Alert — ${belowReorder.length} item${belowReorder.length !== 1 ? "s" : ""} at reorder point`,
            body: belowReorder.map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`).join(", "),
            url: `/dashboard`,
          });
        }).catch(() => {});
      }
    } else {
      await prisma.order.update({ where: { id }, data: { goodsOutStatus: "REJECTED", ...reviewFields } });
      writeAuditLog({ session, action: "REJECT_GOODS_OUT", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    }
    return NextResponse.json({ success: true });
  }

  // ── Transfer approve / reject ─────────────────────────────────────────────
  if (isPendingTransfer) {
    if (action === "approve") {
      if (order.fromLocationId) {
        const stockRows = await prisma.stock.findMany({
          where: { productId: { in: order.lines.map((l) => l.productId) }, locationId: order.fromLocationId },
          include: { product: { select: { name: true } } },
        });
        const stockMap = new Map(stockRows.map((s) => [s.productId, s]));
        const insufficient: string[] = [];
        for (const line of order.lines) {
          const available = stockMap.get(line.productId)?.quantity ?? 0;
          if (available < line.quantity) {
            const name = stockMap.get(line.productId)?.product.name ?? line.productId;
            insufficient.push(`"${name}" — available: ${available}, requested: ${line.quantity}`);
          }
        }
        if (insufficient.length)
          return NextResponse.json({ error: `Insufficient stock:\n${insufficient.join("\n")}` }, { status: 400 });
      }
      await prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          if (!order.fromLocationId || !order.toLocationId) continue;
          await tx.stock.update({
            where: { productId_locationId: { productId: line.productId, locationId: order.fromLocationId } },
            data: { quantity: { decrement: line.quantity } },
          });
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: order.toLocationId } },
            create: { productId: line.productId, locationId: order.toLocationId, quantity: line.quantity },
            update: { quantity: { increment: line.quantity } },
          });
        }
        await tx.order.update({ where: { id }, data: { transferStatus: "APPROVED", ...reviewFields } });
      });
      writeAuditLog({ session, action: "APPROVE_TRANSFER", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
      // Fire reorder alerts after stock decrement from source
      if (order.fromLocationId) {
        prisma.stock.findMany({
          where: { productId: { in: order.lines.map((l) => l.productId) }, locationId: order.fromLocationId, product: { reorderPoint: { gt: 0 } } },
          include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
        }).then((stockRows) => {
          const belowReorder = stockRows.filter((s) => s.quantity <= s.product.reorderPoint);
          if (!belowReorder.length) return;
          sendPushNotification({
            title: `⚠️ Low Stock Alert — ${belowReorder.length} item${belowReorder.length !== 1 ? "s" : ""} at reorder point`,
            body: belowReorder.map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`).join(", "),
            url: `/dashboard`,
          });
        }).catch(() => {});
      }
    } else {
      await prisma.order.update({ where: { id }, data: { transferStatus: "REJECTED", ...reviewFields } });
      writeAuditLog({ session, action: "REJECT_TRANSFER", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
    }
    return NextResponse.json({ success: true });
  }

  // ── Adjustment approve / reject ───────────────────────────────────────────
  if (action === "approve") {
    try {
      await prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          if (!order.toLocationId) continue;

          const existing = await tx.stock.findUnique({
            where: { productId_locationId: { productId: line.productId, locationId: order.toLocationId } },
            select: { quantity: true },
          });
          const currentQty = existing?.quantity ?? 0;
          const newQty = currentQty + line.quantity;

          if (newQty < 0) {
            const product = await tx.product.findUnique({ where: { id: line.productId }, select: { name: true, sku: true } });
            throw new Error(`Insufficient stock for "${product?.name ?? line.productId}" (${product?.sku ?? ""}): has ${currentQty}, adjustment would result in ${newQty}`);
          }

          if (existing) {
            await tx.stock.update({
              where: { productId_locationId: { productId: line.productId, locationId: order.toLocationId } },
              data: { quantity: newQty },
            });
          } else {
            await tx.stock.create({
              data: { productId: line.productId, locationId: order.toLocationId, quantity: newQty },
            });
          }
        }
        await tx.order.update({ where: { id }, data: { adjustmentStatus: "APPROVED", ...reviewFields } });
      });
    } catch (err) {
      console.error("Adjustment approval failed:", err);
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Failed to approve adjustment — please try again",
      }, { status: 500 });
    }
    writeAuditLog({ session, action: "APPROVE_ADJUSTMENT", description: `Approved ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });

    // Reorder alert on negative-adjustment lines
    if (order.toLocationId) {
      const negLines = order.lines.filter((l) => l.quantity < 0);
      if (negLines.length) {
        prisma.stock.findMany({
          where: { productId: { in: negLines.map((l) => l.productId) }, locationId: order.toLocationId, product: { reorderPoint: { gt: 0 } } },
          include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
        }).then((stockRows) => {
          const belowReorder = stockRows.filter((s) => s.quantity <= s.product.reorderPoint);
          if (!belowReorder.length) return;
          sendPushNotification({
            title: `⚠️ Low Stock Alert — ${belowReorder.length} item${belowReorder.length !== 1 ? "s" : ""} at reorder point`,
            body: belowReorder.map((s) => `${s.product.name} (${s.product.sku}): ${s.quantity} left`).join(", "),
            url: `/dashboard`,
          });
        }).catch(() => {});
      }
    }
  } else {
    await prisma.order.update({ where: { id }, data: { adjustmentStatus: "REJECTED", ...reviewFields } });
    writeAuditLog({ session, action: "REJECT_ADJUSTMENT", description: `Rejected ${order.orderNumber}${note ? ` — "${note}"` : ""}`, entityId: id, entityType: "ORDER" });
  }

  return NextResponse.json({ success: true });
}
// ───────────────────────────────────────────────────────────────────────────

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
  const { customer, reference, notes, lines } = body as {
    customer?: string | null;
    reference?: string | null;
    notes?: string | null;
    lines?: Array<{ productId: string; quantity: number; inputQty?: number; inputUnit?: string; notes?: string | null }>;
  };

  if (lines !== undefined) {
    // Full order edit: reverse old stock, replace lines, apply new stock
    if (!lines.length) return NextResponse.json({ error: "At least one line is required" }, { status: 400 });

    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id },
          include: { lines: true },
        });
        if (!current) throw new Error("Order not found");

        // 1. Reverse stock for all existing lines (skip if stock was never applied)
        const skipStock = (current.type === "ADJUSTMENT" && current.adjustmentStatus === "PENDING") ||
                          (current.type === "GRN" && current.grnStatus === "PENDING") ||
                          (current.type === "GOODS_OUT" && current.goodsOutStatus === "PENDING") ||
                          (current.type === "TRANSFER" && current.transferStatus === "PENDING");
        for (const old of current.lines) {
          if (skipStock) continue;
          if (current.type === "GRN" && current.toLocationId) {
            await tx.stock.updateMany({
              where: { productId: old.productId, locationId: current.toLocationId },
              data: { quantity: { decrement: old.quantity } },
            });
          } else if (current.type === "GOODS_OUT" && current.fromLocationId) {
            await tx.stock.updateMany({
              where: { productId: old.productId, locationId: current.fromLocationId },
              data: { quantity: { increment: old.quantity } },
            });
          } else if (current.type === "TRANSFER" && current.fromLocationId && current.toLocationId) {
            await tx.stock.updateMany({
              where: { productId: old.productId, locationId: current.fromLocationId },
              data: { quantity: { increment: old.quantity } },
            });
            await tx.stock.updateMany({
              where: { productId: old.productId, locationId: current.toLocationId },
              data: { quantity: { decrement: old.quantity } },
            });
          } else if (current.type === "ADJUSTMENT" && current.toLocationId) {
            await tx.stock.updateMany({
              where: { productId: old.productId, locationId: current.toLocationId },
              data: { quantity: { decrement: old.quantity } },
            });
          }
        }

        // 2. Delete old movements and lines
        await tx.movement.deleteMany({ where: { orderId: id } });
        await tx.orderLine.deleteMany({ where: { orderId: id } });

        // 3. Update order metadata
        await tx.order.update({
          where: { id },
          data: {
            ...(customer !== undefined ? { customer: customer?.trim() || null } : {}),
            ...(reference !== undefined ? { reference: reference?.trim() || null } : {}),
            ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
          },
        });

        // 4. Create new lines and apply stock
        for (const line of lines!) {
          const orderLine = await tx.orderLine.create({
            data: {
              orderId: id,
              productId: line.productId,
              quantity: line.quantity,
              inputQty: line.inputQty ?? null,
              inputUnit: line.inputUnit ?? null,
              notes: line.notes?.trim() || null,
            },
          });

          await tx.movement.create({
            data: {
              orderId: id,
              orderLineId: orderLine.id,
              productId: line.productId,
              fromLocationId: current.fromLocationId ?? null,
              toLocationId: current.toLocationId ?? null,
              quantity: line.quantity,
              type: MOVEMENT_TYPE[current.type],
            },
          });

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
            // ADJUSTMENT edits on PENDING: stock still not applied — stays deferred to approval
          }
        }
      });
    } catch (err) {
      console.error("Order update failed:", err);
      return NextResponse.json({ error: "Failed to update order — please try again" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  // Metadata-only update (customer, reference, notes, line notes)
  const { lineNotes } = body as { lineNotes?: Array<{ id: string; notes: string | null }> };
  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: {
        ...(customer !== undefined ? { customer: customer?.trim() || null } : {}),
        ...(reference !== undefined ? { reference: reference?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
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

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.type === "ADJUSTMENT" && order.adjustmentStatus === "APPROVED")
    return NextResponse.json({ error: "Approved adjustments cannot be deleted — they are part of the permanent audit trail." }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      if (order.type === "GRN" && order.toLocationId && (order.grnStatus === "APPROVED" || order.grnStatus === null)) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      } else if (order.type === "GOODS_OUT" && order.fromLocationId && (order.goodsOutStatus === "APPROVED" || order.goodsOutStatus === null)) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.fromLocationId },
          data: { quantity: { increment: line.quantity } },
        });
      } else if (order.type === "TRANSFER" && order.fromLocationId && order.toLocationId && (order.transferStatus === "APPROVED" || order.transferStatus === null)) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.fromLocationId },
          data: { quantity: { increment: line.quantity } },
        });
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      } else if (order.type === "ADJUSTMENT" && order.adjustmentStatus === "APPROVED" && order.toLocationId) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      }
    }
    await tx.movement.deleteMany({ where: { orderId: id } });
    await tx.order.delete({ where: { id } });
  });

  const deleteDesc = order.type === "ADJUSTMENT"
    ? `Deleted ${order.orderNumber} (ADJUSTMENT/${order.adjustmentStatus}${order.adjustmentStatus === "APPROVED" ? " — stock reversed" : ""})`
    : `Deleted ${order.orderNumber} (${order.type})`;
  writeAuditLog({ session, action: "DELETE_ORDER", description: deleteDesc, entityId: id, entityType: "ORDER" });

  return NextResponse.json({ success: true });
}
