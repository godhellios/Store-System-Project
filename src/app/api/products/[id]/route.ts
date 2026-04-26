import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      unit: true,
      stock: { include: { location: true } },
    },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(product);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (product.isActive) return NextResponse.json({ error: "Deactivate the product before deleting" }, { status: 400 });

  const orderLineCount = await prisma.orderLine.count({ where: { productId: id } });
  if (orderLineCount > 0) {
    return NextResponse.json(
      { error: "Cannot delete: product has order history. Keep it deactivated instead." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.opnameLine.deleteMany({ where: { productId: id } }),
    prisma.stock.deleteMany({ where: { productId: id } }),
    prisma.product.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, sku, barcode, categoryId, unitId, reorderPoint, colorVariant, description, imageUrl, isActive } = body;

  if (sku) {
    const c = await prisma.product.findFirst({ where: { sku: sku.trim(), NOT: { id } } });
    if (c) return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
  }
  if (barcode) {
    const c = await prisma.product.findFirst({ where: { barcode: barcode.trim(), NOT: { id } } });
    if (c) return NextResponse.json({ error: "Barcode already in use" }, { status: 409 });
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(sku !== undefined ? { sku: sku.trim() } : {}),
      ...(barcode !== undefined ? { barcode: barcode.trim() } : {}),
      ...(categoryId !== undefined ? { category: { connect: { id: categoryId } } } : {}),
      ...(unitId !== undefined ? { unit: { connect: { id: unitId } } } : {}),
      ...(reorderPoint !== undefined ? { reorderPoint: parseInt(reorderPoint) || 0 } : {}),
      ...(colorVariant !== undefined ? { colorVariant: colorVariant?.trim() || null } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl?.trim() || null } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
    include: { category: true, unit: true },
  });

  return NextResponse.json(product);
}
