import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

export { PATCH } from "./_approve";
export { PUT } from "./_edit";

// Covers approve (PATCH), edit (PUT), and delete — all touch every order line,
// so give big orders headroom beyond the platform default.
export const maxDuration = 60;

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
        await tx.stock.updateMany({ where: { productId: line.productId, locationId: order.toLocationId }, data: { quantity: { decrement: line.quantity } } });
      } else if (order.type === "GOODS_OUT" && order.fromLocationId && (order.goodsOutStatus === "APPROVED" || order.goodsOutStatus === null)) {
        await tx.stock.updateMany({ where: { productId: line.productId, locationId: order.fromLocationId }, data: { quantity: { increment: line.quantity } } });
      } else if (order.type === "TRANSFER" && order.fromLocationId && order.toLocationId && (order.transferStatus === "APPROVED" || order.transferStatus === null)) {
        await tx.stock.updateMany({ where: { productId: line.productId, locationId: order.fromLocationId }, data: { quantity: { increment: line.quantity } } });
        await tx.stock.updateMany({ where: { productId: line.productId, locationId: order.toLocationId }, data: { quantity: { decrement: line.quantity } } });
      } else if (order.type === "ADJUSTMENT" && order.adjustmentStatus === "APPROVED" && order.toLocationId) {
        await tx.stock.updateMany({ where: { productId: line.productId, locationId: order.toLocationId }, data: { quantity: { decrement: line.quantity } } });
      }
    }
    await tx.movement.deleteMany({ where: { orderId: id } });
    await tx.order.delete({ where: { id } });
  }, { timeout: 20000, maxWait: 15000 });

  const deleteDesc = order.type === "ADJUSTMENT"
    ? `Deleted ${order.orderNumber} (ADJUSTMENT/${order.adjustmentStatus}${order.adjustmentStatus === "APPROVED" ? " — stock reversed" : ""})`
    : `Deleted ${order.orderNumber} (${order.type})`;
  writeAuditLog({ session, action: "DELETE_ORDER", description: deleteDesc, entityId: id, entityType: "ORDER" });

  return NextResponse.json({ success: true });
}
