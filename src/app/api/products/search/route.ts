import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json([]);

  const full = new URL(req.url).searchParams.get("full") === "1";

  const where = {
    isActive: true,
    AND: [
      { OR: [{ approvalStatus: "ACTIVE" }, { approvalStatus: null }] },
      { OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { sku: { contains: q, mode: "insensitive" as const } },
        { barcode: { contains: q, mode: "insensitive" as const } },
      ]},
    ],
  };
  const orderBy = [{ isActive: "desc" as const }, { name: "asc" as const }];

  try {
    const products = full
      ? await prisma.product.findMany({ where, orderBy, take: 20, include: { category: true, unit: true, unitConversions: true } })
      : await prisma.product.findMany({ where, orderBy, take: 20, select: { id: true, sku: true, name: true } });
    return NextResponse.json(products);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
