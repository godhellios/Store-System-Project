import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json([]);

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } },
      ],
    },
    include: { unit: true, unitConversions: true, category: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 10,
  });

  return NextResponse.json(products);
}
