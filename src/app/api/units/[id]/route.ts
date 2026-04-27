import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name, isActive, parentUnitId, conversionFactor } = await req.json();

  if (name !== undefined) {
    const conflict = await prisma.unit.findFirst({ where: { name: name.trim(), NOT: { id } } });
    if (conflict) return NextResponse.json({ error: "Name already in use" }, { status: 409 });
  }

  // Prevent circular reference
  if (parentUnitId === id)
    return NextResponse.json({ error: "A unit cannot be its own parent" }, { status: 400 });

  const unit = await prisma.unit.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(parentUnitId !== undefined ? { parentUnitId: parentUnitId || null } : {}),
      ...(conversionFactor !== undefined ? { conversionFactor: conversionFactor ? parseFloat(conversionFactor) : null } : {}),
    },
    include: { parent: { select: { id: true, name: true } } },
  });
  return NextResponse.json(unit);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [productCount, childCount] = await Promise.all([
    prisma.product.count({ where: { unitId: id } }),
    prisma.unit.count({ where: { parentUnitId: id } }),
  ]);

  if (productCount > 0)
    return NextResponse.json({ error: `Cannot delete — ${productCount} product(s) use this unit. Deactivate it instead.` }, { status: 409 });
  if (childCount > 0)
    return NextResponse.json({ error: `Cannot delete — ${childCount} unit(s) are based on this unit. Remove those conversions first.` }, { status: 409 });

  await prisma.unit.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
