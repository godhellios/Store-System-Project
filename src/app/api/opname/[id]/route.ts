import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextOrderNumber } from "@/lib/order-number";
import { MovementType } from "@/generated/prisma";

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

  const { id } = await params;
  const body = await req.json();
  const { action, lines, notes } = body;

  const opnameSession = await prisma.opnameSession.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!opnameSession) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update physical counts on lines
  if (action === "update-counts" && lines) {
    await prisma.$transaction(
      lines.map((l: { id: string; physicalQty: number }) =>
        prisma.opnameLine.update({
          where: { id: l.id },
          data: {
            physicalQty: l.physicalQty,
            difference: l.physicalQty - (opnameSession.lines.find((ol) => ol.id === l.id)?.bookQty ?? 0),
          },
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  // Submit for review
  if (action === "submit") {
    const updated = await prisma.opnameSession.update({
      where: { id },
      data: { status: "REVIEWING", notes },
    });
    return NextResponse.json(updated);
  }

  // Approve — create adjustment orders for all discrepancies
  if (action === "approve") {
    const fullSession = await prisma.opnameSession.findUnique({
      where: { id },
      include: { lines: { include: { product: true } } },
    });

    const discrepancies = fullSession!.lines.filter(
      (l) => l.physicalQty !== null && l.difference !== 0
    );

    if (discrepancies.length > 0) {
      await prisma.$transaction(async (tx) => {
        const orderNumber = await nextOrderNumber("ADJUSTMENT");
        const order = await tx.order.create({
          data: {
            orderNumber,
            type: "ADJUSTMENT",
            toLocationId: fullSession!.locationId,
            notes: `Stock Opname approval: ${fullSession!.sessionNumber}`,
          },
        });

        for (const line of discrepancies) {
          const diff = line.difference!;
          const orderLine = await tx.orderLine.create({
            data: { orderId: order.id, productId: line.productId, quantity: Math.abs(diff) },
          });
          await tx.movement.create({
            data: {
              orderId: order.id,
              orderLineId: orderLine.id,
              productId: line.productId,
              toLocationId: fullSession!.locationId,
              quantity: Math.abs(diff),
              type: MovementType.ADJUSTMENT,
            },
          });
          await tx.stock.upsert({
            where: { productId_locationId: { productId: line.productId, locationId: fullSession!.locationId } },
            create: { productId: line.productId, locationId: fullSession!.locationId, quantity: line.physicalQty! },
            update: { quantity: { increment: diff } },
          });
        }
      });
    }

    const updated = await prisma.opnameSession.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const opnameSession = await prisma.opnameSession.findUnique({ where: { id } });
  if (!opnameSession) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (opnameSession.status !== "IN_PROGRESS")
    return NextResponse.json({ error: "Only in-progress sessions can be cancelled" }, { status: 400 });

  await prisma.opnameSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
