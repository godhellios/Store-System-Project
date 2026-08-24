import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { name, isActive, parentUnitId, conversionFactor, suffix: rawSuffix, confirm } = await req.json();

  if (name !== undefined) {
    const conflict = await prisma.unit.findFirst({ where: { name: name.trim(), NOT: { id } } });
    if (conflict) return NextResponse.json({ error: "Name already in use" }, { status: 409 });
  }

  // Prevent circular reference
  if (parentUnitId === id)
    return NextResponse.json({ error: "A unit cannot be its own parent" }, { status: 400 });

  const suffix = rawSuffix !== undefined ? (rawSuffix ? rawSuffix.toUpperCase().trim() : null) : undefined;
  if (suffix !== undefined && suffix !== null && !/^[A-Z]{1,5}$/.test(suffix))
    return NextResponse.json({ error: "Barcode Suffix must be 1–5 uppercase letters (e.g. BOX)" }, { status: 400 });

  const existing = await prisma.unit.findUnique({
    where: { id },
    select: { name: true, conversionFactor: true, parentUnitId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const newFactor = conversionFactor !== undefined
    ? (conversionFactor ? parseFloat(conversionFactor) : null)
    : undefined;
  const factorChanged = newFactor !== undefined && newFactor !== existing.conversionFactor;
  const parentChanged = parentUnitId !== undefined && (parentUnitId || null) !== existing.parentUnitId;

  // Count once — both guards below need it.
  const inUse = (factorChanged || parentChanged)
    ? await prisma.productUnitConversion.count({ where: { unitId: id } })
    : 0;

  // Re-pointing a unit's parent orphans it from products built on the old
  // parent, so it is blocked outright. Checked FIRST: this is a hard refusal,
  // so never ask the user to confirm a factor change we are going to reject
  // anyway (a parent-only change has no factor change to describe).
  if (parentChanged && inUse > 0) {
    return NextResponse.json({
      error: `Cannot change what "${existing.name}" is measured in — ${inUse} product(s) use it as a packing unit. Create a new unit instead.`,
    }, { status: 409 });
  }

  // Renaming is free — the name lives only here, so it flows to every product.
  // Changing the SIZE is not: it redefines what every future entry of this unit
  // means. Ask once, and say how many products are affected. (Past orders are
  // unaffected: they stored their quantity in base units at entry time.)
  if (factorChanged && inUse > 0 && !confirm) {
    return NextResponse.json({
      warning: "unit_in_use",
      productCount: inUse,
      unitName: existing.name,
      oldFactor: existing.conversionFactor,
      newFactor: newFactor ?? existing.conversionFactor,
    }, { status: 200 });
  }

  const unit = await prisma.unit.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(parentUnitId !== undefined ? { parentUnitId: parentUnitId || null } : {}),
      ...(conversionFactor !== undefined ? { conversionFactor: conversionFactor ? parseFloat(conversionFactor) : null } : {}),
      ...(suffix !== undefined ? { suffix } : {}),
    },
    include: { parent: { select: { id: true, name: true } } },
  });
  writeAuditLog({ session, action: "EDIT_UNIT", description: `"${unit.name}"${isActive !== undefined ? (isActive ? " — activated" : " — deactivated") : ""}`, entityId: id, entityType: "UNIT" });
  return NextResponse.json(unit);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const [productCount, childCount, packingCount] = await Promise.all([
    prisma.product.count({ where: { unitId: id } }),
    prisma.unit.count({ where: { parentUnitId: id } }),
    // Packing usage — products now reference this unit rather than copying its
    // name, so deleting it would strip their packaging entirely.
    prisma.productUnitConversion.count({ where: { unitId: id } }),
  ]);

  if (productCount > 0)
    return NextResponse.json({ error: `Cannot delete — ${productCount} product(s) use this unit. Deactivate it instead.` }, { status: 409 });
  if (packingCount > 0)
    return NextResponse.json({ error: `Cannot delete — ${packingCount} product(s) use this as a packing unit. Remove it from those products first, or deactivate it.` }, { status: 409 });
  if (childCount > 0)
    return NextResponse.json({ error: `Cannot delete — ${childCount} unit(s) are based on this unit. Remove those conversions first.` }, { status: 409 });

  const deleted = await prisma.unit.findUnique({ where: { id }, select: { name: true } });
  await prisma.unit.delete({ where: { id } });
  writeAuditLog({ session, action: "DELETE_UNIT", description: `"${deleted?.name ?? id}"`, entityId: id, entityType: "UNIT" });
  return new NextResponse(null, { status: 204 });
}
