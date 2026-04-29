import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const perPage = parseInt(searchParams.get("perPage") ?? "20");

  const where = {
    isActive: true,
    ...(q ? {
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { sku: { contains: q, mode: "insensitive" as const } },
        { barcode: { contains: q, mode: "insensitive" as const } },
      ],
    } : {}),
    ...(categoryId ? { categoryId } : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        category: true,
        unit: true,
        stock: { include: { location: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return NextResponse.json({ products, total, page, pages: Math.ceil(total / perPage) });
}

function genBarcode(): string {
  return "MR" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, sku, barcode, categoryId, unitId, reorderPoint, colorVariant, description, imageUrl, unitConversions } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!categoryId) return NextResponse.json({ error: "Category is required" }, { status: 400 });
  if (!unitId) return NextResponse.json({ error: "Unit is required" }, { status: 400 });

  // Auto-generate SKU if blank
  let finalSku = sku?.trim();
  if (!finalSku) {
    const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
    const prefix = (cat?.name ?? "PRD").slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "X");
    const total = await prisma.product.count();
    let candidate = `${prefix}-${String(total + 1).padStart(4, "0")}`;
    let attempt = 0;
    while (await prisma.product.findUnique({ where: { sku: candidate } })) {
      attempt++;
      candidate = `${prefix}-${String(total + 1 + attempt).padStart(4, "0")}`;
    }
    finalSku = candidate;
  } else {
    const conflict = await prisma.product.findUnique({ where: { sku: finalSku } });
    if (conflict) return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
  }

  // Auto-generate barcode if blank
  let finalBarcode = barcode?.trim();
  if (!finalBarcode) {
    let candidate = genBarcode();
    while (await prisma.product.findUnique({ where: { barcode: candidate } })) {
      candidate = genBarcode();
    }
    finalBarcode = candidate;
  } else {
    const conflict = await prisma.product.findUnique({ where: { barcode: finalBarcode } });
    if (conflict) return NextResponse.json({ error: "Barcode already exists" }, { status: 409 });
  }

  const validConversions = Array.isArray(unitConversions)
    ? unitConversions.filter((c: { name?: string; conversionFactor?: number }) =>
        c.name?.trim() && (c.conversionFactor ?? 0) > 0
      )
    : [];

  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      sku: finalSku,
      barcode: finalBarcode,
      categoryId,
      unitId,
      reorderPoint: parseInt(reorderPoint) || 0,
      colorVariant: colorVariant?.trim() || null,
      description: description?.trim() || null,
      imageUrl: imageUrl?.trim() || null,
      ...(validConversions.length > 0 ? {
        unitConversions: {
          create: validConversions.map((c: { name: string; conversionFactor: number }) => ({
            name: c.name.trim(),
            conversionFactor: c.conversionFactor,
          })),
        },
      } : {}),
    },
    include: { category: true, unit: true, unitConversions: true },
  });

  return NextResponse.json(product, { status: 201 });
}
