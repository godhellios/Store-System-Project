import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type BulkResult = { id: string; status: "ok" | "skipped" | "error"; message?: string };

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { action, ids } = await req.json() as { action: string; ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: "No IDs provided" }, { status: 400 });

  const results: BulkResult[] = [];

  if (action === "deactivate") {
    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    for (const id of ids) results.push({ id, status: "ok" });

  } else if (action === "delete") {
    for (const id of ids) {
      try {
        const product = await prisma.product.findUnique({ where: { id } });
        if (!product) { results.push({ id, status: "skipped", message: "Not found" }); continue; }
        if (product.isActive) {
          results.push({ id, status: "skipped", message: `"${product.name}" is still active — deactivate it first` });
          continue;
        }
        const orderLineCount = await prisma.orderLine.count({ where: { productId: id } });
        if (orderLineCount > 0) {
          results.push({ id, status: "skipped", message: `"${product.name}" has order history — keep it deactivated` });
          continue;
        }
        await prisma.$transaction([
          prisma.opnameLine.deleteMany({ where: { productId: id } }),
          prisma.stock.deleteMany({ where: { productId: id } }),
          prisma.productUnitConversion.deleteMany({ where: { productId: id } }),
          prisma.product.delete({ where: { id } }),
        ]);
        results.push({ id, status: "ok" });
      } catch (err) {
        results.push({ id, status: "error", message: err instanceof Error ? err.message : "Unknown error" });
      }
    }
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  return NextResponse.json({ results });
}
