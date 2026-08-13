import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

type PendingChanges = {
  name?: string;
  categoryId?: string;
  unitId?: string;
  reorderPoint?: number;
  colorVariant?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  // Packing units are stored as a reference to the Unit master. Older pending
  // edits (submitted before that change) still carry the typed name/factor —
  // those are resolved back to a unit on approval rather than being dropped.
  unitConversions?: { unitId?: string; name?: string; conversionFactor?: number; barcode?: string | null }[];
};

// POST /api/products/[id]/approve
// Body: { action: "approve" | "reject", note?: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { action, note } = await req.json();

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const reviewerName = session.user.name ?? session.user.email ?? null;
  const isDraft = product.approvalStatus === "DRAFT";
  const hasPendingEdit = product.pendingChangedAt !== null;

  if (!isDraft && !hasPendingEdit) {
    return NextResponse.json({ error: "Product has nothing pending review" }, { status: 409 });
  }

  if (action === "reject") {
    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(isDraft ? { approvalStatus: "REJECTED" } : {}),
        // Always clear pending submitter fields regardless of DRAFT or edit request
        pendingChanges: Prisma.DbNull,
        pendingChangedBy: null,
        pendingChangedAt: null,
        reviewedByName: reviewerName,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
    return NextResponse.json(updated);
  }

  // action === "approve"
  if (isDraft) {
    const updated = await prisma.product.update({
      where: { id },
      data: {
        approvalStatus: "ACTIVE",
        // Clear submitter fields so the product doesn't reappear in pending queue
        pendingChanges: Prisma.DbNull,
        pendingChangedBy: null,
        pendingChangedAt: null,
        reviewedByName: reviewerName,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
    return NextResponse.json(updated);
  }

  // Approving a pending edit on an existing ACTIVE product — apply the changes
  const changes = product.pendingChanges as PendingChanges | null;
  if (!changes) return NextResponse.json({ error: "No pending changes to apply" }, { status: 409 });

  // Resolve each pending conversion to a Unit id. New submissions already carry
  // unitId; legacy ones carry a typed name, matched ignoring case and spaces —
  // the same rule the migration used. Anything unresolvable is dropped rather
  // than blocking the approval, and is reported back to the admin.
  let validConversions: Array<{ unitId: string; barcode?: string | null }> | undefined;
  const unresolved: string[] = [];
  if (Array.isArray(changes.unitConversions)) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
    const allUnits = await prisma.unit.findMany({ select: { id: true, name: true } });
    const byNorm = new Map(allUnits.map((u) => [norm(u.name), u.id]));
    const known = new Set(allUnits.map((u) => u.id));
    validConversions = [];
    for (const c of changes.unitConversions) {
      const resolved = c.unitId && known.has(c.unitId)
        ? c.unitId
        : c.name ? byNorm.get(norm(c.name)) : undefined;
      if (resolved) validConversions.push({ unitId: resolved, barcode: c.barcode ?? null });
      else if (c.name || c.unitId) unresolved.push(c.name ?? c.unitId!);
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.categoryId !== undefined ? { category: { connect: { id: changes.categoryId } } } : {}),
      ...(changes.unitId !== undefined ? { unit: { connect: { id: changes.unitId } } } : {}),
      ...(changes.reorderPoint !== undefined ? { reorderPoint: changes.reorderPoint } : {}),
      ...(changes.colorVariant !== undefined ? { colorVariant: changes.colorVariant } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.imageUrl !== undefined ? { imageUrl: changes.imageUrl } : {}),
      pendingChanges: Prisma.DbNull,
      pendingChangedBy: null,
      pendingChangedAt: null,
      reviewedByName: reviewerName,
      reviewedAt: new Date(),
      reviewNote: note?.trim() || null,
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

  return NextResponse.json(
    unresolved.length ? { ...updated, unresolvedPackingUnits: unresolved } : updated
  );
}
