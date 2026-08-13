import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { packingViews } from "@/lib/packing-units";

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
      { OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] },
      ...(textFilter ? [textFilter] : []),
    ],
  };
  const orderBy = [{ isActive: "desc" as const }, { name: "asc" as const }];
  // When browsing by category only (no text), load up to 200; text searches stay at 20
  const take = q ? 20 : 200;

  try {
    if (!full) {
      const slim = await prisma.product.findMany({ where, orderBy, take, select: { id: true, sku: true, name: true } });
      return NextResponse.json(slim);
    }
    const products = await prisma.product.findMany({
      where, orderBy, take,
      include: { category: true, unit: true, unitConversions: { include: { unit: true } }, stock: true },
    });
    // Packing name + factor live on the Unit master — flatten for the entry forms.
    return NextResponse.json(
      products.map((p) => ({ ...p, unitConversions: packingViews(p.unitConversions) })),
    );
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
