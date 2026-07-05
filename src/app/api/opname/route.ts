import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { viewerGuard } from "@/lib/role-guard";
import { overlapsExistingCount } from "@/lib/opname-scope";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await prisma.opnameSession.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      location: true,
      _count: { select: { lines: true } },
    },
  });
  return NextResponse.json(sessions);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Only admins can start a stock opname session" }, { status: 403 });

  const { locationId, notes, categoryIds } = await req.json();
  if (!locationId) return NextResponse.json({ error: "Location is required" }, { status: 400 });
  const catIds: string[] = Array.isArray(categoryIds) ? categoryIds.filter((x): x is string => typeof x === "string") : [];

  // Overlap guard: don't start a count that overlaps an open one at this location
  // (shared category, or either side whole-warehouse). Non-overlapping category
  // counts may run concurrently.
  const openHere = await prisma.opnameSession.findMany({
    where: { locationId, status: { in: ["IN_PROGRESS", "REVIEWING"] } },
    select: { id: true, sessionNumber: true, locationId: true, categories: { select: { id: true } } },
  });
  const conflict = overlapsExistingCount(
    openHere.map((s) => ({ id: s.id, sessionNumber: s.sessionNumber, locationId: s.locationId, categoryIds: s.categories.map((c) => c.id) })),
    catIds
  );
  if (conflict)
    return NextResponse.json(
      { error: `This warehouse already has an open count (${conflict.sessionNumber}) that overlaps${catIds.length ? " a selected category" : ""}. Finish or cancel it first.` },
      { status: 409 }
    );

  const year = new Date().getFullYear();
  const last = await prisma.opnameSession.findFirst({
    where: { sessionNumber: { startsWith: `OPN-${year}-` } },
    orderBy: { sessionNumber: "desc" },
    select: { sessionNumber: true },
  });
  const lastNum = last ? parseInt(last.sessionNumber.split("-").pop() ?? "0") : 0;
  const sessionNumber = `OPN-${year}-${String(lastNum + 1).padStart(4, "0")}`;

  // Pre-fill lines with current stock for blind counting
  const currentStock = await prisma.stock.findMany({
    where: { locationId, product: { isActive: true, ...(catIds.length ? { categoryId: { in: catIds } } : {}) } },
    include: { product: true },
  });

  const opnameSession = await prisma.opnameSession.create({
    data: {
      sessionNumber,
      locationId,
      notes,
      createdByName: session.user.name ?? null,
      ...(catIds.length ? { categories: { connect: catIds.map((id) => ({ id })) } } : {}),
      lines: {
        create: currentStock.map((s) => ({
          productId: s.productId,
          bookQty: s.quantity,
        })),
      },
    },
    include: { location: true, categories: true, lines: { include: { product: { include: { unit: true } } } } },
  });

  return NextResponse.json(opnameSession, { status: 201 });
}
