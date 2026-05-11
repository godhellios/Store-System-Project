import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { viewerGuard } from "@/lib/role-guard";

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
  const vg = viewerGuard(session); if (vg) return vg;

  const { locationId, notes } = await req.json();
  if (!locationId) return NextResponse.json({ error: "Location is required" }, { status: 400 });

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
    where: { locationId, product: { isActive: true } },
    include: { product: true },
  });

  const opnameSession = await prisma.opnameSession.create({
    data: {
      sessionNumber,
      locationId,
      notes,
      createdByName: session.user.name ?? null,
      lines: {
        create: currentStock.map((s) => ({
          productId: s.productId,
          bookQty: s.quantity,
        })),
      },
    },
    include: { location: true, lines: { include: { product: { include: { unit: true } } } } },
  });

  return NextResponse.json(opnameSession, { status: 201 });
}
