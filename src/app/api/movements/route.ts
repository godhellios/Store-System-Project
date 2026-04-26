import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId") ?? "";
  const locationId = searchParams.get("locationId") ?? "";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = 50;

  const where = {
    ...(productId ? { productId } : {}),
    ...(locationId ? {
      OR: [{ fromLocationId: locationId }, { toLocationId: locationId }],
    } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to + "T23:59:59") } : {}),
      },
    } : {}),
  };

  const [movements, total] = await Promise.all([
    prisma.movement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        product: { include: { unit: true } },
        fromLocation: true,
        toLocation: true,
        order: true,
      },
    }),
    prisma.movement.count({ where }),
  ]);

  return NextResponse.json({ movements, total, page, pages: Math.ceil(total / perPage) });
}
