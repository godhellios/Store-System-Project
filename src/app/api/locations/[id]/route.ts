import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { name, type, isActive } = await req.json();

  if (name !== undefined) {
    const conflict = await prisma.location.findFirst({ where: { name: name.trim(), NOT: { id } } });
    if (conflict) return NextResponse.json({ error: "Name already in use" }, { status: 409 });
  }

  const location = await prisma.location.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(type !== undefined ? { type: type.trim() } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });
  return NextResponse.json(location);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const [stockCount, orderCount, movementCount] = await Promise.all([
    prisma.stock.count({ where: { locationId: id, quantity: { gt: 0 } } }),
    prisma.order.count({ where: { OR: [{ fromLocationId: id }, { toLocationId: id }] } }),
    prisma.movement.count({ where: { OR: [{ fromLocationId: id }, { toLocationId: id }] } }),
  ]);

  if (stockCount > 0)
    return NextResponse.json({ error: "Cannot delete — location still has stock. Deactivate it instead." }, { status: 409 });
  if (orderCount > 0 || movementCount > 0)
    return NextResponse.json({ error: "Cannot delete — location has order or movement history. Deactivate it instead." }, { status: 409 });

  await prisma.location.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
