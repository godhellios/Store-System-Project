import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const units = await prisma.unit.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      parent: { select: { id: true, name: true } },
      children: { select: { id: true, name: true, conversionFactor: true } },
    },
  });
  return NextResponse.json(units);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, parentUnitId, conversionFactor } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (parentUnitId && !conversionFactor)
    return NextResponse.json({ error: "Conversion factor is required when setting a parent unit" }, { status: 400 });

  const existing = await prisma.unit.findUnique({ where: { name: name.trim() } });
  if (existing) return NextResponse.json({ error: "Unit already exists" }, { status: 409 });

  const unit = await prisma.unit.create({
    data: {
      name: name.trim(),
      parentUnitId: parentUnitId || null,
      conversionFactor: parentUnitId ? parseFloat(conversionFactor) : null,
    },
    include: { parent: { select: { id: true, name: true } } },
  });
  return NextResponse.json(unit, { status: 201 });
}
