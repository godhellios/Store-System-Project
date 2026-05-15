import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/products/lookup?q=<barcode or SKU>
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("q")?.trim();
  if (!raw) return NextResponse.json({ error: "Query required" }, { status: 400 });
  const q = decodeURIComponent(raw);

  // Only scannable by active products (DRAFT products cannot be used in transactions)
  const activeFilter = { approvalStatus: "ACTIVE" as const };

  const include = {
    category: true,
    unit: true,
    unitConversions: true,
    stock: { include: { location: true } },
  };

  // 1. Try Product.barcode or Product.sku (base unit)
  const byProduct = await prisma.product.findFirst({
    where: { AND: [{ OR: [{ barcode: q }, { sku: q }] }, activeFilter] },
    include,
  });
  if (byProduct) {
    return NextResponse.json({ product: byProduct, matchedUnit: null, isUnitBarcode: false });
  }

  // 2. Try ProductUnitConversion.barcode
  const byUnit = await prisma.productUnitConversion.findFirst({
    where: { barcode: q },
    include: { product: { include } },
  });
  if (byUnit && byUnit.product) {
    // Check product is active
    const status = byUnit.product.approvalStatus;
    if (status !== "ACTIVE" && status !== null) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({
      product: byUnit.product,
      matchedUnit: { id: byUnit.id, name: byUnit.name, conversionFactor: byUnit.conversionFactor },
      isUnitBarcode: true,
    });
  }

  return NextResponse.json({ error: "Product not found" }, { status: 404 });
}

