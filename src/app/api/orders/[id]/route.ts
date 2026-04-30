import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MovementType, OrderType } from "@/generated/prisma";

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

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "STAFF"].includes(session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
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

        // 1. Reverse stock for all existing lines
        for (const old of current.lines) {
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

          if (current.type === "GRN" && current.toLocationId) {
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: current.toLocationId } },
              create: { productId: line.productId, locationId: current.toLocationId, quantity: line.quantity },
              update: { quantity: { increment: line.quantity } },
            });
          } else if (current.type === "GOODS_OUT" && current.fromLocationId) {
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: current.fromLocationId } },
              create: { productId: line.productId, locationId: current.fromLocationId, quantity: -line.quantity },
              update: { quantity: { decrement: line.quantity } },
            });
          } else if (current.type === "TRANSFER" && current.fromLocationId && current.toLocationId) {
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: current.fromLocationId } },
              create: { productId: line.productId, locationId: current.fromLocationId, quantity: -line.quantity },
              update: { quantity: { decrement: line.quantity } },
            });
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: current.toLocationId } },
              create: { productId: line.productId, locationId: current.toLocationId, quantity: line.quantity },
              update: { quantity: { increment: line.quantity } },
            });
          } else if (current.type === "ADJUSTMENT" && current.toLocationId) {
            await tx.stock.upsert({
              where: { productId_locationId: { productId: line.productId, locationId: current.toLocationId } },
              create: { productId: line.productId, locationId: current.toLocationId, quantity: line.quantity },
              update: { quantity: { increment: line.quantity } },
            });
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
      } else if (order.type === "ADJUSTMENT" && order.toLocationId) {
        await tx.stock.updateMany({
          where: { productId: line.productId, locationId: order.toLocationId },
          data: { quantity: { decrement: line.quantity } },
        });
      }
    }
    await tx.movement.deleteMany({ where: { orderId: id } });
    await tx.order.delete({ where: { id } });
  });

  return NextResponse.json({ success: true });
}
