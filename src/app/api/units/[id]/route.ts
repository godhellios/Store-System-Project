import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name, isActive } = await req.json();

  if (name !== undefined) {
    const conflict = await prisma.unit.findFirst({ where: { name: name.trim(), NOT: { id } } });
    if (conflict) return NextResponse.json({ error: "Name already in use" }, { status: 409 });
  }

  const unit = await prisma.unit.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });
  return NextResponse.json(unit);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const inUse = await prisma.product.count({ where: { unitId: id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${inUse} product(s) use this unit. Deactivate it instead.` },
      { status: 409 }
    );
  }

  await prisma.unit.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
