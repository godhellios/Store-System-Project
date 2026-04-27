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

  const product = await prisma.product.findFirst({
    where: {
      OR: [{ barcode: q }, { sku: q }],
    },
    include: {
      category: true,
      unit: true,
      unitConversions: true,
      stock: { include: { location: true } },
    },
  });

  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  return NextResponse.json(product);
}
