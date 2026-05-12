import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

// POST /api/orders/[id]/cancel
// Body: { reason?: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { reason } = await req.json();

  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (order.cancelledAt) {
    return NextResponse.json({ error: "Order is already cancelled" }, { status: 409 });
  }

  if (order.type === "ADJUSTMENT" && order.adjustmentStatus === "PENDING") {
    return NextResponse.json(
      { error: "Pending adjustments must be rejected, not cancelled. Use the Reject button." },
      { status: 400 }
    );
  }
  if (order.type === "GRN" && order.grnStatus === "PENDING") {
    return NextResponse.json(
      { error: "Pending GRNs must be rejected, not cancelled. Use the Reject button." },
      { status: 400 }
    );
  }
  if (order.type === "GOODS_OUT" && order.goodsOutStatus === "PENDING") {
    return NextResponse.json(
      { error: "Pending Goods Out orders must be rejected, not cancelled. Use the Reject button." },
      { status: 400 }
    );
  }
  if (order.type === "TRANSFER" && order.transferStatus === "PENDING") {
    return NextResponse.json(
      { error: "Pending Transfer orders must be rejected, not cancelled. Use the Reject button." },
      { status: 400 }
    );
  }

  // Pre-check: reversals that decrement stock — verify it won't go negative
  const grnStockApplied = order.type === "GRN" && (order.grnStatus === "APPROVED" || order.grnStatus === null);
  const transferStockApplied = order.type === "TRANSFER" && (order.transferStatus === "APPROVED" || order.transferStatus === null);
  if ((grnStockApplied && order.toLocationId) || (transferStockApplied && order.toLocationId)) {
    const locationId = order.toLocationId!;
    const productIds = order.lines.map((l) => l.productId);
    const stockRows = await prisma.stock.findMany({
      where: { productId: { in: productIds }, locationId },
      include: { product: { select: { name: true } } },
    });
    const stockMap = new Map(stockRows.map((s) => [s.productId, s]));
    const blocked: string[] = [];
    for (const line of order.lines) {
      const current = stockMap.get(line.productId)?.quantity ?? 0;
      if (current < line.quantity) {
        const name = stockMap.get(line.productId)?.product.name ?? line.productId;
        blocked.push(`"${name}" — available ${current}, need to reverse ${line.quantity}`);
      }
    }
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: `Cannot cancel — stock was already partially used:\n${blocked.join("\n")}` },
        { status: 409 }
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      if (grnStockApplied && order.toLocationId) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      } else if (order.type === "GOODS_OUT" && order.fromLocationId && (order.goodsOutStatus === "APPROVED" || order.goodsOutStatus === null)) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.fromLocationId },
          data: { quantity: { increment: line.quantity } },
        });
      } else if (transferStockApplied && order.fromLocationId && order.toLocationId) {
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
      // REJECTED adjustment: stock was never applied — nothing to reverse
    }

    await tx.order.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        cancelledByName: session.user.name ?? session.user.email ?? null,
        cancelReason: reason?.trim() || null,
      },
    });
  });

  writeAuditLog({
    session,
    action: "CANCEL_ORDER",
    description: `Cancelled ${order.orderNumber} (${order.type})${reason?.trim() ? ` — "${reason.trim()}"` : ""}`,
    entityId: id,
    entityType: "ORDER",
  });

  return NextResponse.json({ success: true });
}
