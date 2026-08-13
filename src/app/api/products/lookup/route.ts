import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { packingViews, packingFactorOf } from "@/lib/packing-units";

// GET /api/products/lookup?q=<barcode or SKU>
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("q")?.trim();
  if (!raw) return NextResponse.json({ error: "Query required" }, { status: 400 });
  const q = decodeURIComponent(raw);

  // Only scannable by active products (DRAFT products cannot be used in transactions)
  const activeFilter = { OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] };

  // Packing name + factor live on the Unit master, so the relation must come
  // along — without it a scanned box barcode has no factor and would be
  // received as a single base unit.
  const include = {
    category: true,
    unit: true,
    unitConversions: { include: { unit: true } },
    stock: { include: { location: true } },
  };
  const flatten = <P extends { unitConversions: Parameters<typeof packingViews>[0] }>(p: P) => ({
    ...p,
    unitConversions: packingViews(p.unitConversions),
  });

  // 1. Try Product.barcode or Product.sku (base unit)
  const byProduct = await prisma.product.findFirst({
    where: { AND: [{ OR: [{ barcode: q }, { sku: q }] }, activeFilter] },
    include,
  });
  if (byProduct) {
    return NextResponse.json({ product: flatten(byProduct), matchedUnit: null, isUnitBarcode: false });
  }

  // 2. Try ProductUnitConversion.barcode
  const byUnit = await prisma.productUnitConversion.findFirst({
    where: { barcode: q },
    include: { unit: true, product: { include } },
  });
  if (byUnit && byUnit.product) {
    // Check product is active
    const status = byUnit.product.approvalStatus;
    if (status !== "ACTIVE" && status !== null) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    const factor = packingFactorOf(byUnit.unit);
    if (factor === null) {
      // The unit lost its factor in Settings — refuse rather than silently
      // receiving a whole box as one piece.
      return NextResponse.json(
        { error: `"${byUnit.unit.name}" has no quantity set in Settings › Units — set how many it holds first` },
        { status: 409 },
      );
    }
    return NextResponse.json({
      product: flatten(byUnit.product),
      matchedUnit: { id: byUnit.id, name: byUnit.unit.name, conversionFactor: factor },
      isUnitBarcode: true,
    });
  }

  return NextResponse.json({ error: "Product not found" }, { status: 404 });
}
