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

  await prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      if (order.type === "GRN" && order.toLocationId) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      } else if (order.type === "GOODS_OUT" && order.fromLocationId) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.fromLocationId },
          data: { quantity: { increment: line.quantity } },
        });
      } else if (order.type === "TRANSFER" && order.fromLocationId && order.toLocationId) {
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
