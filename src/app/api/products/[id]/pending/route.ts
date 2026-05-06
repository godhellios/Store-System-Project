import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

// DELETE /api/products/[id]/pending — cancel a pending edit
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Staff can only cancel their own pending edits; admin can cancel any
  const isAdmin = session.user.role === "ADMIN";
  const isOwner = product.pendingChangedBy === (session.user.name ?? session.user.email);
  if (!isAdmin && !isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.product.update({
    where: { id },
    data: { pendingChanges: Prisma.DbNull, pendingChangedBy: null, pendingChangedAt: null },
  });

  return NextResponse.json({ success: true });
}
