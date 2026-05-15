import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

// POST /api/products/approve-bulk
// Body: { ids: string[], action: "approve" | "reject", note?: string }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { ids, action, note } = await req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const reviewerName = session.user.name ?? session.user.email ?? null;
  const reviewData = {
    reviewedByName: reviewerName,
    reviewedAt: new Date(),
    reviewNote: note?.trim() || null,
    // Always clear submitter fields so products don't reappear in the pending queue
    pendingChanges: Prisma.DbNull,
    pendingChangedBy: null,
    pendingChangedAt: null,
  };

  // Handle DRAFT products (new product approvals)
  const draftResult = await prisma.product.updateMany({
    where: { id: { in: ids }, approvalStatus: "DRAFT" },
    data: { approvalStatus: action === "approve" ? "ACTIVE" : "REJECTED", ...reviewData },
  });

  // Handle pending edit requests on ACTIVE products (reject = discard; approve = require individual review)
  // Bulk reject simply discards the pending changes. Bulk approve of edits is not supported here
  // because each edit's pendingChanges must be applied individually â€” use the single /approve endpoint.
  let editResult = { count: 0 };
  if (action === "reject") {
    editResult = await prisma.product.updateMany({
      where: {
        id: { in: ids },
        approvalStatus: "ACTIVE",
        pendingChangedAt: { not: null },
      },
      data: reviewData,
    });
  }

  const editRequestsSkipped =
    action === "approve" ? Math.max(0, ids.length - draftResult.count) : 0;

  return NextResponse.json({
    updated: draftResult.count + editResult.count,
    editRequestsSkipped,
  });
}

