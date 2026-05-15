import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const categoryId = searchParams.get("categoryId")?.trim() ?? "";
  const full = searchParams.get("full") === "1";

  if (!q && !categoryId) return NextResponse.json([]);

  const textFilter = q ? { OR: [
    { name: { contains: q, mode: "insensitive" as const } },
    { sku: { contains: q, mode: "insensitive" as const } },
    { barcode: { contains: q, mode: "insensitive" as const } },
    { colorVariant: { contains: q, mode: "insensitive" as const } },
  ]} : undefined;

  const where = {
    isActive: true,
    ...(categoryId ? { categoryId } : {}),
    AND: [
      { approvalStatus: "ACTIVE" as const },
      ...(textFilter ? [textFilter] : []),
    ],
  };
  const orderBy = [{ isActive: "desc" as const }, { name: "asc" as const }];
  // When browsing by category only (no text), load up to 200; text searches stay at 20
  const take = q ? 20 : 200;

  try {
    const products = full
      ? await prisma.product.findMany({ where, orderBy, take, include: { category: true, unit: true, unitConversions: true, stock: true } })
      : await prisma.product.findMany({ where, orderBy, take, select: { id: true, sku: true, name: true } });
    return NextResponse.json(products);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}


