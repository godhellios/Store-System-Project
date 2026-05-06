import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/products/pending — admin-only list of DRAFT products and products with pending edits
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { approvalStatus: "DRAFT" },
        // pendingChangedAt being set signals a pending edit on an active product
        { pendingChangedAt: { not: null } },
      ],
    },
    orderBy: { pendingChangedAt: "asc" },
    include: {
      category: true,
      unit: true,
      unitConversions: true,
    },
  });

  return NextResponse.json(products);
}
