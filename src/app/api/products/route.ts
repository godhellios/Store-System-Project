import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSku } from "@/lib/sku";
import { generateBaseBarcode, generateUnitBarcode, validateBarcodeUniqueness } from "@/lib/barcode";
import { findSimilarProducts } from "@/lib/duplicate-detect";
import { viewerGuard } from "@/lib/role-guard";

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
    AND: [
      // Only ACTIVE (or legacy null) products visible in main list — DRAFTs live in /products/pending
      { OR: [{ approvalStatus: "ACTIVE" as const }, { approvalStatus: null }] },
      ...(q ? [{ OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { sku: { contains: q, mode: "insensitive" as const } },
        { barcode: { contains: q, mode: "insensitive" as const } },
      ]}] : []),
    ],
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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const vg = viewerGuard(session); if (vg) return vg;

  const body = await req.json();
  const { name, categoryId, unitId, reorderPoint, colorVariant, description, imageUrl, unitConversions, force } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!categoryId) return NextResponse.json({ error: "Category is required" }, { status: 400 });
  if (!unitId) return NextResponse.json({ error: "Unit is required" }, { status: 400 });

  // Fuzzy duplicate check — skipped when user explicitly confirms
  if (!force) {
    const duplicates = await findSimilarProducts(name.trim());
    if (duplicates.length > 0) {
      return NextResponse.json({ error: "Similar products found", duplicates }, { status: 409 });
    }
  }

  const isAdmin = session.user.role === "ADMIN";
  const approvalStatus = isAdmin ? "ACTIVE" : "DRAFT";
  const createdByName = session.user.name ?? session.user.email ?? null;

  const validConversions = Array.isArray(unitConversions)
    ? unitConversions.filter(
        (c: { name?: string; conversionFactor?: number }) =>
          c.name?.trim() && (c.conversionFactor ?? 0) > 0
      )
    : [];

  try {
    const product = await prisma.$transaction(async (tx) => {
      const sku = await generateSku(categoryId, tx);
      const baseBarcode = generateBaseBarcode(sku);

      const conversionsWithBarcodes = validConversions.map(
        (c: { name: string; conversionFactor: number; barcode?: string | null }) => {
          const explicitBarcode = c.barcode?.trim() || null;
          if (explicitBarcode) return { ...c, barcode: explicitBarcode };
          // Derive suffix from conversion name (uppercase alphanumeric, max 5 chars)
          const suffix = c.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
          return { ...c, barcode: generateUnitBarcode(sku, suffix) };
        }
      );

      const allBarcodes = [
        baseBarcode,
        ...conversionsWithBarcodes.map((c: { barcode: string | null }) => c.barcode).filter(Boolean),
      ] as string[];
      await validateBarcodeUniqueness(allBarcodes, tx);

      return tx.product.create({
        data: {
          name: name.trim(),
          sku,
          barcode: baseBarcode,
          categoryId,
          unitId,
          reorderPoint: parseInt(reorderPoint) || 0,
          colorVariant: colorVariant?.trim() || null,
          description: description?.trim() || null,
          imageUrl: imageUrl?.trim() || null,
          approvalStatus,
          ...(isAdmin ? {} : {
            pendingChangedBy: createdByName,
            pendingChangedAt: new Date(),
          }),
          ...(conversionsWithBarcodes.length > 0 ? {
            unitConversions: {
              create: conversionsWithBarcodes.map(
                (c: { name: string; conversionFactor: number; barcode: string | null }) => ({
                  name: c.name.trim(),
                  conversionFactor: c.conversionFactor,
                  barcode: c.barcode || null,
                })
              ),
            },
          } : {}),
        },
        include: { category: true, unit: true, unitConversions: true },
      });
    });

    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create product";
    if (msg.includes("has no code set")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
