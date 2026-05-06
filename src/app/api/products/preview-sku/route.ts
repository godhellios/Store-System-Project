import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/products/preview-sku?categoryId=xxx
// Returns the next SKU that would be generated for a category (non-locking preview).
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const categoryId = new URL(req.url).searchParams.get("categoryId");
  if (!categoryId) return NextResponse.json({ error: "categoryId required" }, { status: 400 });

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { name: true, code: true },
  });

  if (!category?.code) {
    return NextResponse.json(
      { error: `Category '${category?.name ?? categoryId}' has no code set. Admin must set it in Settings.` },
      { status: 422 }
    );
  }

  const code = category.code;
  const last = await prisma.product.findFirst({
    where: { sku: { startsWith: `${code}-` } },
    orderBy: { sku: "desc" },
    select: { sku: true },
  });

  const num = last ? parseInt(last.sku.split("-").pop() ?? "0", 10) : 0;
  const preview = `${code}-${String(num + 1).padStart(5, "0")}`;

  return NextResponse.json({ sku: preview });
}
