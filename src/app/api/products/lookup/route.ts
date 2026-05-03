import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/products/lookup?q=<barcode or SKU>
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Query required" }, { status: 400 });

  const include = {
    category: true,
    unit: true,
    unitConversions: true,
    stock: { include: { location: true } },
  };

  // 1. Try Product.barcode or Product.sku (base unit)
  const byProduct = await prisma.product.findFirst({
    where: { OR: [{ barcode: q }, { sku: q }] },
    include,
  });
  if (byProduct) {
    return NextResponse.json({ product: byProduct, matchedUnit: null });
  }

  // 2. Try ProductUnitConversion.barcode
  const byUnit = await prisma.productUnitConversion.findUnique({
    where: { barcode: q },
    include: { product: { include } },
  });
  if (byUnit) {
    return NextResponse.json({
      product: byUnit.product,
      matchedUnit: { id: byUnit.id, name: byUnit.name, conversionFactor: byUnit.conversionFactor },
    });
  }

  return NextResponse.json({ error: "Product not found" }, { status: 404 });
}
