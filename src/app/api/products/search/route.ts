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

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ approvalStatus: "ACTIVE" }, { approvalStatus: null }] },
        { OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
        ]},
      ],
    },
    ...(full
      ? { include: { category: true, unit: true, unitConversions: true } }
      : { select: { id: true, sku: true, name: true } }),
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 20,
  });

  return NextResponse.json(products);
}
