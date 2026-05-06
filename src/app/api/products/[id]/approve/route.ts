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
  unitConversions?: { name: string; conversionFactor: number; barcode?: string | null }[];
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

  const validConversions = Array.isArray(changes.unitConversions)
    ? changes.unitConversions.filter((c) => c.name?.trim() && (c.conversionFactor ?? 0) > 0)
    : undefined;

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
            name: c.name.trim(),
            conversionFactor: c.conversionFactor,
            barcode: c.barcode?.trim() || null,
          })),
        },
      } : {}),
    },
    include: { category: true, unit: true, unitConversions: true },
  });

  return NextResponse.json(updated);
}
