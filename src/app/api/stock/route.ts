import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get("locationId") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const lowOnly = searchParams.get("lowOnly") === "true";

  const stock = await prisma.stock.findMany({
    where: {
      product: { isActive: true, ...(categoryId ? { categoryId } : {}) },
      ...(locationId ? { locationId } : {}),
      ...(lowOnly ? {} : {}),
    },
    include: {
      product: { include: { category: true, unit: true } },
      location: true,
    },
    orderBy: [{ location: { name: "asc" } }, { product: { name: "asc" } }],
  });

  const filtered = lowOnly
    ? stock.filter((s) => s.quantity <= s.product.reorderPoint)
    : stock;

  return NextResponse.json(filtered);
}
