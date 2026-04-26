import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
        include: {
          product: { include: { category: true, unit: true } },
        },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "STAFF"].includes(session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { reference, notes, lineNotes } = body as {
    reference?: string | null;
    notes?: string | null;
    lineNotes?: Array<{ id: string; notes: string | null }>;
  };

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: {
        ...(reference !== undefined ? { reference: reference?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
      },
    });

    if (lineNotes?.length) {
      for (const ln of lineNotes) {
        await tx.orderLine.update({
          where: { id: ln.id },
          data: { notes: ln.notes?.trim() || null },
        });
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

  const order = await prisma.order.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    // Reverse stock for each line
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
      } else if (order.type === "ADJUSTMENT" && order.toLocationId) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      }
    }

    // Delete movements first (no cascade on order→movement)
    await tx.movement.deleteMany({ where: { orderId: id } });
    // Delete order (cascades to orderLines)
    await tx.order.delete({ where: { id } });
  });

  return NextResponse.json({ success: true });
}
