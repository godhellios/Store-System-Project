import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { Prisma } from "@/generated/prisma";
import { viewerGuard } from "@/lib/role-guard";
import { applyOpeningCost, applyCorrectCost, OpeningCostError } from "@/lib/opening-cost";
import { isEligiblePackingUnit } from "@/lib/packing-units";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      unit: true,
      unitConversions: { include: { unit: true } },
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

  writeAuditLog({ session, action: "DELETE_PRODUCT", description: `Deleted "${product.name}" (${product.sku})`, entityId: id, entityType: "PRODUCT" });

  return NextResponse.json({ success: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vg = viewerGuard(session); if (vg) return vg;

  const { id } = await params;
  const body = await req.json();
  const { name, sku, barcode, categoryId, unitId, reorderPoint, colorVariant, description, imageUrl, isActive, unitConversions } = body;
  const isAdmin = session.user.role === "ADMIN";

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Non-admin edits are stored as pending changes and require admin approval.
  // isActive changes (deactivate/activate) are allowed directly for any role.
  if (!isAdmin && isActive === undefined) {
    const submitterName = session.user.name ?? session.user.email ?? null;
    if (existing.pendingChangedAt && existing.pendingChangedBy !== submitterName) {
      return NextResponse.json({
        error: `This product already has a pending edit from ${existing.pendingChangedBy ?? "another user"}. Wait for admin review before submitting another change.`,
      }, { status: 409 });
    }
    const changes = {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(unitId !== undefined ? { unitId } : {}),
      ...(reorderPoint !== undefined ? { reorderPoint: parseInt(reorderPoint) || 0 } : {}),
      ...(colorVariant !== undefined ? { colorVariant: colorVariant?.trim() || null } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl?.trim() || null } : {}),
      ...(Array.isArray(unitConversions) ? { unitConversions } : {}),
    };

    const updated = await prisma.product.update({
      where: { id },
      data: {
        pendingChanges: changes,
        pendingChangedBy: submitterName,
        pendingChangedAt: new Date(),
      },
    });

    writeAuditLog({
      session,
      action: "SUBMIT_PRODUCT_EDIT",
      description: `"${existing.name}" (${existing.sku}) — submitted edit for admin review`,
      entityId: id,
      entityType: "PRODUCT",
    });

    return NextResponse.json({ ...updated, _pendingSubmitted: true });
  }

  // Admin: apply directly (also clears any pending edits)
  if (sku && sku.trim() !== existing.sku) {
    const [orderLineCount, movementCount] = await Promise.all([
      prisma.orderLine.count({ where: { productId: id } }),
      prisma.movement.count({ where: { productId: id } }),
    ]);
    if (orderLineCount > 0 || movementCount > 0)
      return NextResponse.json(
        { error: "SKU cannot be changed — this product already has transaction history. Deactivate and create a new product instead." },
        { status: 409 }
      );
    const c = await prisma.product.findFirst({ where: { sku: sku.trim(), NOT: { id } } });
    if (c) return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
  }
  if (barcode) {
    const c = await prisma.product.findFirst({ where: { barcode: barcode.trim(), NOT: { id } } });
    if (c) return NextResponse.json({ error: "Barcode already in use" }, { status: 409 });
  }

  // Packing units come from the Unit master; a unit is only legal when its
  // parent is this product's base unit (see lib/packing-units.ts).
  let validConversions: Array<{ unitId: string; barcode?: string | null }> | undefined;
  if (Array.isArray(unitConversions)) {
    const effectiveBaseUnitId = unitId !== undefined ? unitId : existing.unitId;
    const ids = [...new Set(
      (unitConversions as Array<{ unitId?: string }>).map((c) => c.unitId).filter((u): u is string => !!u),
    )];
    const master = ids.length
      ? await prisma.unit.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, isActive: true, parentUnitId: true, conversionFactor: true },
        })
      : [];
    const byId = new Map(master.map((u) => [u.id, u]));
    for (const uid of ids) {
      const u = byId.get(uid);
      if (!isEligiblePackingUnit(u, effectiveBaseUnitId)) {
        return NextResponse.json({
          error: u
            ? `"${u.name}" can't be used as a packing unit for this product — in Settings it is measured in a different unit.`
            : "Unknown packing unit",
        }, { status: 400 });
      }
    }
    validConversions = (unitConversions as Array<{ unitId?: string; barcode?: string | null }>)
      .filter((c) => c.unitId && byId.has(c.unitId))
      .map((c) => ({ unitId: c.unitId!, barcode: c.barcode ?? null }));
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
      // Clear any pending edits when admin saves directly
      pendingChanges: Prisma.DbNull,
      pendingChangedBy: null,
      pendingChangedAt: null,
      ...(validConversions !== undefined ? {
        unitConversions: {
          deleteMany: {},
          create: validConversions.map((c) => ({
            unitId: c.unitId,
            barcode: c.barcode?.trim() || null,
          })),
        },
      } : {}),
    },
    include: { category: true, unit: true, unitConversions: { include: { unit: true } } },
  });

  writeAuditLog({ session, action: "EDIT_PRODUCT", description: `Edited "${product.name}" (${product.sku})`, entityId: id, entityType: "PRODUCT" });

  return NextResponse.json(product);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { openingCost, correctCost } = body as { openingCost?: number; correctCost?: number };

  if (openingCost === undefined && correctCost === undefined) {
    return NextResponse.json({ error: "Provide openingCost or correctCost" }, { status: 400 });
  }

  try {
    if (correctCost !== undefined) {
      if (typeof correctCost !== "number" || correctCost <= 0) {
        return NextResponse.json({ error: "correctCost must be a number greater than zero" }, { status: 400 });
      }
      const { oldAvgCost } = await prisma.$transaction((tx) => applyCorrectCost(tx, id, correctCost));
      const product = await prisma.product.findUnique({ where: { id }, select: { name: true, sku: true } });
      writeAuditLog({
        session,
        action: "CORRECT_OPENING_COST",
        description: `Corrected cost for "${product?.name}" (${product?.sku}) from Rp ${oldAvgCost != null ? oldAvgCost.toLocaleString("id-ID") : "none"} to Rp ${correctCost.toLocaleString("id-ID")}`,
        entityId: id,
        entityType: "PRODUCT",
      });
      return NextResponse.json({ success: true, avgCost: correctCost });
    }

    if (openingCost !== undefined) {
      if (typeof openingCost !== "number" || openingCost <= 0) {
        return NextResponse.json({ error: "openingCost must be a number greater than zero" }, { status: 400 });
      }
      await prisma.$transaction((tx) => applyOpeningCost(tx, id, openingCost));
      const product = await prisma.product.findUnique({ where: { id }, select: { name: true, sku: true } });
      writeAuditLog({
        session,
        action: "SET_OPENING_COST",
        description: `Set opening cost for "${product?.name}" (${product?.sku}) to Rp ${openingCost.toLocaleString("id-ID")}`,
        entityId: id,
        entityType: "PRODUCT",
      });
      return NextResponse.json({ success: true, avgCost: openingCost });
    }
  } catch (err) {
    if (err instanceof OpeningCostError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("not found")) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
